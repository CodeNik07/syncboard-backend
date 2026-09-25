import request from 'supertest';
import { app } from '../src/index.js';
import { Board, Element } from '../src/models/index.js';

describe('Board API endpoints', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should create a new board', async () => {
    const res = await request(app)
      .post('/api/board/create')
      .send({ title: 'Test Board' });

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBeDefined();
    expect(res.body.boardId).toBe(res.body.roomId);

    const board = await Board.findOne({ roomId: res.body.roomId });
    expect(board).not.toBeNull();
    expect(board?.title).toBe('Test Board');
  });

  it('should get a board by id', async () => {
    const createRes = await request(app)
      .post('/api/board/create')
      .send({ title: 'Fetch Me' });

    const roomId = createRes.body.roomId;

    const res = await request(app).get(`/api/board/${roomId}`);
    expect(res.status).toBe(200);
    expect(res.body.board.title).toBe('Fetch Me');
    expect(res.body.elements).toEqual([]);
  });
});
