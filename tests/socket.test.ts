import { httpServer } from '../src/index.js';
import { Client, Socket as ClientSocket } from 'socket.io-client';
import io from 'socket.io-client';
import { Board, Session, Element } from '../src/models/index.js';

let clientSocket: ClientSocket;
let port: number;

beforeAll((done) => {
  httpServer.listen(() => {
    port = (httpServer.address() as any).port;
    clientSocket = io(`http://localhost:${port}`);
    clientSocket.on('connect', done);
  });
});

afterAll((done) => {
  if (clientSocket.connected) {
    clientSocket.disconnect();
  }
  httpServer.close(done);
});

describe('Socket.io Events', () => {
  it('should handle JOIN_BOARD', (done) => {
    clientSocket.emit('JOIN_BOARD', {
      boardId: 'test-room',
      sessionId: 'sess-123',
      username: 'TestUser',
      color: '#000000',
    });

    clientSocket.on('BOARD_STATE', async (data) => {
      expect(data.elements).toBeDefined();
      expect(data.users).toBeDefined();
      expect(data.users.length).toBeGreaterThan(0);
      
      const session = await Session.findOne({ sessionId: 'sess-123' });
      expect(session).not.toBeNull();
      expect(session?.username).toBe('TestUser');
      
      clientSocket.off('BOARD_STATE');
      done();
    });
  });

  it('should broadcast ADD_ELEMENT', (done) => {
    const testElement = { id: 'el-1', type: 'rectangle', x: 10, y: 10 };
    
    const clientSocket2 = io(`http://localhost:${port}`);
    clientSocket2.on('connect', () => {
      clientSocket2.emit('JOIN_BOARD', {
        boardId: 'test-room',
        sessionId: 'sess-456',
        username: 'User2',
        color: '#FFFFFF'
      });
      
      clientSocket2.on('ADD_ELEMENT', (el) => {
        expect(el.id).toBe('el-1');
        clientSocket2.disconnect();
        done();
      });

      // Give it a small delay to join room before emitting from client 1
      setTimeout(() => {
        clientSocket.emit('ADD_ELEMENT', { boardId: 'test-room', element: testElement });
      }, 50);
    });
  });
});
