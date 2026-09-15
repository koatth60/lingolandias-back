import {
  buildChatFileKey,
  buildPublicUrl,
  getExtension,
  isBlockedChatFile,
  sanitizeChatFileName,
  MAX_FILENAME_LENGTH,
} from './chat-file-policy';

describe('chat file policy', () => {
  describe('sanitizeChatFileName', () => {
    it('keeps an ordinary filename untouched', () => {
      expect(sanitizeChatFileName('homework.pdf')).toBe('homework.pdf');
    });

    it('keeps accents, which the URL builder percent-encodes later', () => {
      expect(sanitizeChatFileName('Gramática.pdf')).toBe('Gramática.pdf');
    });

    it('replaces spaces so the key never contains one', () => {
      expect(sanitizeChatFileName('Unidad 3 repaso.pdf')).toBe('Unidad_3_repaso.pdf');
    });

    it('strips "#", which truncates an href and broke shared files', () => {
      expect(sanitizeChatFileName('Clase #2.pdf')).not.toContain('#');
    });

    it('strips "?", which would turn the rest of the name into a query string', () => {
      expect(sanitizeChatFileName('what?.pdf')).not.toContain('?');
    });

    it('drops any directory component so a key cannot escape the prefix', () => {
      expect(sanitizeChatFileName('../../etc/passwd')).toBe('passwd');
      expect(sanitizeChatFileName('C:\\Users\\me\\deck.pptx')).toBe('deck.pptx');
    });

    it('never returns an empty string', () => {
      expect(sanitizeChatFileName('')).toBe('file');
      expect(sanitizeChatFileName('...')).toBe('file');
    });

    it('truncates a very long name but keeps its extension', () => {
      const long = `${'a'.repeat(400)}.pdf`;
      const result = sanitizeChatFileName(long);
      expect(result.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
      expect(result.endsWith('.pdf')).toBe(true);
    });
  });

  describe('getExtension', () => {
    it('reads the last extension, lowercased', () => {
      expect(getExtension('a.b.PDF')).toBe('pdf');
    });

    it('returns empty for a name with no extension', () => {
      expect(getExtension('README')).toBe('');
    });

    it('does not treat a leading dot as an extension', () => {
      expect(getExtension('.gitignore')).toBe('');
    });
  });

  describe('isBlockedChatFile', () => {
    it('blocks executables', () => {
      ['virus.exe', 'setup.MSI', 'run.bat', 'thing.apk', 'x.sh'].forEach((name) =>
        expect(isBlockedChatFile(name)).toBe(true),
      );
    });

    // The whole point of the change: these are what teachers actually send,
    // and the previous MIME allowlist rejected several of them outright.
    it('allows the teaching material that used to be rejected', () => {
      [
        'lesson.pdf', 'class.mp4', 'recording.mov', 'clip.webm',
        'deck.pptx', 'sheet.xlsx', 'notes.docx', 'subs.srt',
        'data.csv', 'photo.heic', 'archive.zip', 'audio.m4a',
      ].forEach((name) => expect(isBlockedChatFile(name)).toBe(false));
    });
  });

  describe('buildPublicUrl', () => {
    it('percent-encodes a key so accents and spaces resolve', () => {
      const url = buildPublicUrl('bucket', 'eu-west-1', 'chat-uploads/1-Gramática.pdf');
      expect(url).toBe(
        'https://bucket.s3.eu-west-1.amazonaws.com/chat-uploads/1-Gram%C3%A1tica.pdf',
      );
    });

    it('keeps path separators unencoded', () => {
      const url = buildPublicUrl('b', 'r', 'chat-uploads/file.pdf');
      expect(url).toContain('/chat-uploads/file.pdf');
    });
  });

  describe('buildChatFileKey', () => {
    it('always lands under the chat-uploads prefix', () => {
      expect(buildChatFileKey('../evil.pdf').startsWith('chat-uploads/')).toBe(true);
    });

    it('prefixes with a timestamp so repeated names do not collide', () => {
      const key = buildChatFileKey('a.pdf');
      expect(key).toMatch(/^chat-uploads\/\d+-a\.pdf$/);
    });
  });
});
