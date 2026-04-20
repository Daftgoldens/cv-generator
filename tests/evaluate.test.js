'use strict';
const { parseEvaluationResult } = require('../src/evaluate');

describe('parseEvaluationResult', () => {
  test('extracts score from JSON summary at end of output', () => {
    const text = `Bloc A content...\nBloc F content...\n{"score":4.2,"company":"Mistral AI","role":"AI Engineer","keywords":["LLM","RAG","FastAPI"]}`;
    const result = parseEvaluationResult(text);
    expect(result.score).toBe(4.2);
    expect(result.company).toBe('Mistral AI');
    expect(result.role).toBe('AI Engineer');
    expect(result.keywords).toContain('LLM');
  });

  test('returns null score if no JSON found', () => {
    const result = parseEvaluationResult('No JSON here');
    expect(result.score).toBeNull();
    expect(result.company).toBe('');
    expect(result.keywords).toEqual([]);
  });

  test('handles JSON anywhere in the text', () => {
    const text = 'Some text {"score":3.5,"company":"OpenAI","role":"Engineer","keywords":["Python"]} more text';
    const result = parseEvaluationResult(text);
    expect(result.score).toBe(3.5);
  });
});
