import { describe, expect, it } from 'vitest';
import type { CleanupClient } from './cleanup';
import { defaultConfig } from './config';
import { processTranscript } from './pipeline';
import { detectCommand, splitTrailingEnter } from './segments';

const echo: CleanupClient = {
  generate: async (_s, u) => u.replace(/<\/?transcript>\n?/g, '').trim(),
};

describe('spoken commands', () => {
  it('recognises whole-utterance commands, ignoring case and punctuation', () => {
    expect(detectCommand('Select all.')).toBe('select-all');
    expect(detectCommand('undo')).toBe('undo');
    expect(detectCommand('Undo that!')).toBe('undo');
    expect(detectCommand('press enter')).toBe('press-enter');
    expect(detectCommand('Press Tab.')).toBe('press-tab');
    expect(detectCommand('press escape')).toBe('press-escape');
    expect(detectCommand('scratch that')).toBe('delete-last');
  });

  it('does not treat the same words inside a sentence as commands', () => {
    expect(detectCommand('please select all the files')).toBeNull();
    expect(detectCommand('I want to undo the change')).toBeNull();
    expect(detectCommand('do not press enter yet')).toBeNull();
  });

  it('splits a trailing "press enter" from the dictated text', () => {
    expect(splitTrailingEnter('sounds good press enter')).toEqual({
      text: 'sounds good',
      enter: true,
    });
    expect(splitTrailingEnter('Sounds good, press enter.')).toEqual({
      text: 'Sounds good',
      enter: true,
    });
    expect(splitTrailingEnter('press enter to continue')).toEqual({
      text: 'press enter to continue',
      enter: false,
    });
    expect(splitTrailingEnter('press enter')).toEqual({ text: 'press enter', enter: false }); // a command, not text
  });

  it('the pipeline asks for Enter after the text, at every cleanup level', async () => {
    for (const cleanupLevel of ['none', 'light'] as const) {
      const r = await processTranscript('see you at five press enter', {
        config: { ...defaultConfig(), cleanupLevel },
        client: echo,
      });
      expect(r).toEqual({ kind: 'insert', text: 'see you at five', pressEnter: true });
    }
  });

  it('ordinary dictation does not ask for Enter', async () => {
    const r = await processTranscript('see you at five', { config: defaultConfig(), client: echo });
    expect(r).toEqual({ kind: 'insert', text: 'see you at five' });
  });
});
