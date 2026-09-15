/**
 * Shared naming/validation policy for chat attachments.
 *
 * Lives outside the S3 service because both the legacy multipart endpoint and
 * the presigned-URL flow have to agree on exactly one answer for "what key
 * does this file get?" and "is this file allowed?" — a presigned PUT is
 * signed against a specific key, so any disagreement between the two paths
 * produces a signature mismatch at upload time instead of a clear error.
 */

// Characters that either break a URL outright once the key is turned into one
// ('#' truncates the href, '?' starts a query string) or that S3 documents as
// needing special handling. Accents and other non-ASCII are deliberately kept:
// buildPublicUrl percent-encodes the key, so "Gramática.pdf" survives intact
// instead of being mangled into "Gramtica.pdf".
const URL_HOSTILE = /[#?%\\^`"'<>{}|[\]~]|[\x00-\x1f\x7f]/g;

// Only executables are refused. Everything else a teacher might plausibly
// share — video, audio, documents, archives, subtitles — is allowed, and
// there is no size ceiling anywhere in the pipeline. The point of this list
// is to stop the bucket (which serves over the school's own domain) being
// used to hand out malware, not to police file types.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys',
  'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'jse',
  'ps1', 'psm1', 'sh', 'bash', 'zsh', 'run', 'bin',
  'apk', 'app', 'dmg', 'deb', 'rpm', 'jar',
]);

export const MAX_FILENAME_LENGTH = 180;

export const getExtension = (filename: string): string => {
  const base = (filename || '').split(/[\\/]/).pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
};

export const isBlockedChatFile = (filename: string): boolean =>
  BLOCKED_EXTENSIONS.has(getExtension(filename));

/**
 * Turns whatever the browser reported as the filename into something safe to
 * use as the tail of an S3 key. Never returns an empty string.
 */
export const sanitizeChatFileName = (filename: string): string => {
  // Strip any directory component first — some browsers send a full path for
  // a drag-and-dropped file, and "../" in a key would land the object
  // somewhere other than chat-uploads/.
  const base = (filename || '').split(/[\\/]/).pop() || '';

  const cleaned = base
    .replace(URL_HOSTILE, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .trim();

  if (!cleaned) return 'file';
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;

  // Too long: keep the extension (it drives how the client renders the
  // attachment) and truncate the stem rather than the other way round.
  const ext = getExtension(cleaned);
  if (!ext) return cleaned.slice(0, MAX_FILENAME_LENGTH);
  const stemBudget = MAX_FILENAME_LENGTH - ext.length - 1;
  return `${cleaned.slice(0, Math.max(1, stemBudget))}.${ext}`;
};

/** Full S3 key for a chat attachment, timestamp-prefixed so names can repeat. */
export const buildChatFileKey = (filename: string): string =>
  `chat-uploads/${Date.now()}-${sanitizeChatFileName(filename)}`;

/**
 * Public https URL for a key. Each path segment is percent-encoded — without
 * this, a key containing a space or an accented character produces a URL the
 * browser either rewrites inconsistently or fails to resolve at all.
 */
export const buildPublicUrl = (
  bucketName: string,
  region: string,
  key: string,
): string => {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucketName}.s3.${region}.amazonaws.com/${encoded}`;
};
