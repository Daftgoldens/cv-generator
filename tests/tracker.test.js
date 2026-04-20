'use strict';
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn()
}));

const { createClient } = require('@supabase/supabase-js');

// Mock Supabase client shape
function makeSupabaseMock(returnData, returnError = null) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  chain.select.mockImplementation(() => ({
    ...chain,
    order: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
  }));
  chain.insert.mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: returnData, error: returnError })
    })
  });
  chain.update.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: returnData, error: returnError })
      })
    })
  });
  chain.delete.mockReturnValue({
    eq: jest.fn().mockResolvedValue({ data: null, error: returnError })
  });
  return { from: jest.fn(() => chain) };
}

describe('tracker.js', () => {
  let tracker;

  beforeEach(() => {
    jest.clearAllMocks();
    tracker = require('../src/tracker');
  });

  test('listApplications returns array from supabase', async () => {
    const mockData = [{ id: 'abc', company: 'Mistral', role: 'AI Engineer', status: 'Evaluated' }];
    createClient.mockReturnValue(makeSupabaseMock(mockData));
    const result = await tracker.listApplications();
    expect(result).toEqual(mockData);
  });

  test('createApplication inserts and returns record', async () => {
    const mockRecord = { id: 'xyz', company: 'Anthropic', role: 'Engineer', score: 4.5 };
    createClient.mockReturnValue(makeSupabaseMock(mockRecord));
    const result = await tracker.createApplication({ company: 'Anthropic', role: 'Engineer', score: 4.5 });
    expect(result.company).toBe('Anthropic');
    expect(result.score).toBe(4.5);
  });

  test('listPipeline returns unprocessed URLs', async () => {
    const mockData = [{ id: '1', url: 'https://example.com', processed: false }];
    createClient.mockReturnValue(makeSupabaseMock(mockData));
    const result = await tracker.listPipeline();
    expect(Array.isArray(result)).toBe(true);
  });
});
