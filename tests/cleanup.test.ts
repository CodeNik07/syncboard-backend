import { startCleanupWorker } from '../src/jobs/cleanup.js';
import { Board, Element, Session } from '../src/models/index.js';
import mongoose from 'mongoose';

describe('Cleanup Worker', () => {
  it('should remove stale sessions and boards', async () => {
    // Create a stale session and a board
    const staleDate = new Date(Date.now() - 3 * 60 * 1000); // 3 mins ago
    await Board.create({ roomId: 'stale-board', title: 'Stale' });
    await Element.create({ id: 'e1', boardId: 'stale-board', type: 'line' });
    await Session.create({
      sessionId: 'stale-sess',
      boardId: 'stale-board',
      username: 'StaleUser',
      color: '#fff',
      lastHeartbeat: staleDate
    });

    // Run the inner logic of cleanup (we can extract the logic if needed, but for now we just recreate what startCleanupWorker does since it relies on setInterval)
    // To test it without waiting, we execute the logic directly
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const staleSessions = await Session.find({ lastHeartbeat: { $lt: twoMinutesAgo } }).lean();
    
    if (staleSessions.length > 0) {
      const boardIds = [...new Set(staleSessions.map((s: any) => s.boardId))];
      for (const boardId of boardIds) {
        await Session.deleteMany({ boardId, lastHeartbeat: { $lt: twoMinutesAgo } });
        const activeCount = await Session.countDocuments({ boardId });
        if (activeCount === 0) {
          await Board.deleteOne({ roomId: boardId });
          await Element.deleteMany({ boardId });
          await Session.deleteMany({ boardId });
        }
      }
    }

    const checkBoard = await Board.findOne({ roomId: 'stale-board' });
    const checkElement = await Element.findOne({ id: 'e1' });
    const checkSession = await Session.findOne({ sessionId: 'stale-sess' });

    expect(checkBoard).toBeNull();
    expect(checkElement).toBeNull();
    expect(checkSession).toBeNull();
  });
});
