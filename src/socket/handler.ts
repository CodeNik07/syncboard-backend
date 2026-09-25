import { Server, Socket } from 'socket.io'
import { Board, Element, Session, YjsDocument } from '../models/index.js'

// In-memory cursor positions for performance
const roomCursors = new Map() // roomId -> Map<sessionId, cursorData>

export function setupSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`)

    let currentRoom: string | null = null
    let currentSession: { sessionId: string; username: string; color: string } | null = null
    let hasLeft = false

    // JOIN_BOARD
    socket.on('JOIN_BOARD', async (data: any) => {
      const { boardId, sessionId, username, color } = data
      currentRoom = boardId
      currentSession = { sessionId, username, color }
      hasLeft = false

      socket.join(boardId)

      // Create/update session
      await Session.findOneAndUpdate(
        { sessionId, boardId },
        { sessionId, boardId, username, color, lastHeartbeat: new Date() },
        { upsert: true, new: true }
      )

      // Initialize cursor map for room
      if (!roomCursors.has(boardId)) {
        roomCursors.set(boardId, new Map())
      }

      // Send board state to new user
      const elements = await Element.find({ boardId }).lean()
      const users = await Session.find({ boardId }).lean()

      socket.emit('BOARD_STATE', { elements, users })

      // Notify others
      socket.to(boardId).emit('USER_JOINED', { username, color })
      io.to(boardId).emit('PRESENCE_UPDATE', users)

      // Broadcast activity
      io.to(boardId).emit('ACTIVITY_EVENT', {
        id: Date.now().toString(),
        message: `${username} joined the board`,
        username, color,
        timestamp: new Date().toISOString(),
        type: 'join',
      })
    })

    // LEAVE_BOARD
    socket.on('LEAVE_BOARD', async (data: any) => {
      if (hasLeft) return
      hasLeft = true
      await handleLeave(socket, io, data?.boardId || currentRoom, currentSession)
    })

    // CURSOR_MOVE
    socket.on('CURSOR_MOVE', (data: any) => {
      const { boardId, sessionId, username, color, x, y } = data
      const cursors = roomCursors.get(boardId)
      if (cursors) {
        cursors.set(sessionId, { sessionId, username, color, x, y })
        // Broadcast all cursors to room
        socket.to(boardId).emit('CURSORS_UPDATE', Array.from(cursors.values()))
      }
    })

    // CLEAR_BOARD
    socket.on('CLEAR_BOARD', async (data: any) => {
      const { boardId } = data
      try {
        await Element.deleteMany({ boardId })
        socket.to(boardId).emit('CLEAR_BOARD')

        io.to(boardId).emit('ACTIVITY_EVENT', {
          id: Date.now().toString(),
          message: `${currentSession?.username || 'User'} cleared the board`,
          username: currentSession?.username || 'User',
          color: currentSession?.color || '#6366F1',
          timestamp: new Date().toISOString(),
          type: 'clear',
        })
      } catch (err) {
        console.error('[CLEAR_BOARD]', err)
      }
    })

    // ACTIVITY_EVENT
    socket.on('ACTIVITY_EVENT', (data: any) => {
      const { boardId, event } = data
      socket.to(boardId).emit('ACTIVITY_EVENT', event)
    })

    // UPDATE_USERNAME — update session record and broadcast new presence
    socket.on('UPDATE_USERNAME', async (data: any) => {
      const { boardId, sessionId, username } = data
      try {
        // Update session in DB
        await Session.findOneAndUpdate(
          { sessionId, boardId },
          { username }
        )
        // Update local session reference
        if (currentSession && currentSession.sessionId === sessionId) {
          currentSession.username = username
        }
        // Broadcast updated user list to all users in the room
        const users = await Session.find({ boardId }).lean()
        io.to(boardId).emit('PRESENCE_UPDATE', users)
      } catch (err) {
        console.error('[UPDATE_USERNAME]', err)
      }
    })

    // CHAT_MESSAGE — live chat
    socket.on('CHAT_MESSAGE', (data: any) => {
      const { boardId, message } = data
      // Broadcast to all users in the room (including sender)
      io.to(boardId).emit('CHAT_MESSAGE', {
        id: Date.now().toString(),
        message,
        username: currentSession?.username || 'User',
        color: currentSession?.color || '#6366F1',
        sessionId: currentSession?.sessionId,
        timestamp: new Date().toISOString(),
      })
    })

    // HEARTBEAT
    socket.on('HEARTBEAT', async (data: any) => {
      const { boardId, sessionId } = data
      try {
        await Session.findOneAndUpdate(
          { sessionId, boardId },
          { lastHeartbeat: new Date() }
        )
      } catch (err) {
        console.error('[HEARTBEAT]', err)
      }
    })

    // DISCONNECT
    socket.on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`)
      if (currentRoom && currentSession && !hasLeft) {
        hasLeft = true
        await handleLeave(socket, io, currentRoom, currentSession)
      }
    })
  })
}

async function handleLeave(socket: Socket, io: Server, boardId: string, session: { sessionId: string; username: string; color: string } | null) {
  if (!boardId || !session) return

  try {
    // Remove session
    await Session.deleteOne({ sessionId: session.sessionId, boardId })

    // Remove cursor
    const cursors = roomCursors.get(boardId)
    if (cursors) {
      cursors.delete(session.sessionId)
      if (cursors.size === 0) roomCursors.delete(boardId)
    }

    socket.leave(boardId)

    // Notify others
    socket.to(boardId).emit('USER_LEFT', { username: session.username, color: session.color })

    // Check remaining sessions
    const remaining = await Session.countDocuments({ boardId })

    if (remaining === 0) {
      // Last user left — delete everything
      console.log(`[Cleanup] Last user left board ${boardId}. Deleting...`)
      await Board.deleteOne({ roomId: boardId })
      await Element.deleteMany({ boardId })
      await Session.deleteMany({ boardId })
      await YjsDocument.deleteOne({ roomId: boardId })
      roomCursors.delete(boardId)

      // Notify any lingering connections
      io.to(boardId).emit('BOARD_DELETED')
    } else {
      const users = await Session.find({ boardId }).lean()
      io.to(boardId).emit('PRESENCE_UPDATE', users)
    }
  } catch (err) {
    console.error('[LEAVE]', err)
  }
}
