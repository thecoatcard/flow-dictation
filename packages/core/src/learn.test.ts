import { describe, expect, it } from 'vitest';
import { learnTerms } from './learn';

describe('learnTerms', () => {
  it('proposes a technical term that replaced a mis-heard phrase', () => {
    expect(learnTerms('we deploy it on cooper net is', 'we deploy it on Kubernetes')).toEqual([
      'Kubernetes',
    ]);
  });

  it('proposes names, camelCase, acronyms, versions and identifiers', () => {
    const after =
      'Ask Anand to use buildSystemPrompt with the EPAM API on k8s and Node.js for GPT4.';
    expect(learnTerms('ask to use with the on and for.', after)).toEqual([
      'Anand',
      'buildSystemPrompt',
      'EPAM',
      'API',
      'k8s',
      'Node.js',
      'GPT4',
    ]);
  });

  it('ignores everyday words, plain numbers and the capital that starts a sentence', () => {
    expect(learnTerms('i went to form', 'I went to the form. Then we left at 7 pm.')).toEqual([]);
  });

  it('ignores words that were already in the original text, and terms already in the dictionary', () => {
    expect(learnTerms('Send it to Anand', 'Send it to Anand and Rahul', ['rahul'])).toEqual([]);
    expect(learnTerms('hi', 'hi Rahul Rahul', [])).toEqual(['Rahul']); // no repeats
  });

  it('strips quotes and trailing punctuation', () => {
    expect(learnTerms('x', 'Use “Flow”, then (Gemini).')).toEqual(['Flow', 'Gemini']);
  });

  it('proposes nothing when nothing changed', () => {
    expect(learnTerms('same text', 'same text')).toEqual([]);
  });
});
