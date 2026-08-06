import { describe, expect, it } from 'vitest';
import type { AdminUserResult } from '../db/queries/adminUsers';
import { MEDIA_FORMATS, MEDIA_FORMAT_LABELS } from '../media';
import { MAX_UPLOAD_BYTES } from '../media/upload';
import {
  ADMIN_UPLOAD_ERRORS,
  ADMIN_UPLOAD_HINT,
  ADMIN_USERS_FAILURES,
  ADMIN_USERS_MESSAGES,
  formatFileSize,
} from './admin';

/**
 * The upload copy is generated from `MEDIA_FORMATS`, not typed out, so that the
 * panel cannot promise a format `/media/**` will not serve. These assertions are
 * what catches somebody hardcoding the list back into the sentence.
 */
describe('upload copy', () => {
  it('names every format the media module can serve, and no more', () => {
    const labels = Object.values(MEDIA_FORMAT_LABELS);
    expect(labels).toHaveLength(Object.keys(MEDIA_FORMATS).length);

    for (const label of labels) {
      expect(ADMIN_UPLOAD_HINT, label).toContain(label);
      expect(ADMIN_UPLOAD_ERRORS.unsupported_format, label).toContain(label);
    }

    // The Ukrainian conjunction, not a bare comma-separated list.
    expect(ADMIN_UPLOAD_HINT).toContain(`${MEDIA_FORMAT_LABELS.jpg} і ${MEDIA_FORMAT_LABELS.png}`);
  });

  it('states the byte cap wherever it is mentioned', () => {
    const megabytes = `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`;
    expect(ADMIN_UPLOAD_HINT).toContain(megabytes);
    expect(ADMIN_UPLOAD_ERRORS.too_large).toContain(megabytes);
  });
});

/**
 * `/users` renders `ADMIN_USERS_MESSAGES[reason]` for whatever the query layer
 * hands back, so a refusal with no entry there renders as `undefined` — an
 * empty banner over an action that silently did nothing, which is the worst
 * possible way to find out an account was not archived.
 *
 * The `Record` is the guard, not the loop: adding a reason to `AdminUserResult`
 * without listing it here stops the build, and listing one without a sentence
 * fails the assertion below.
 */
describe('the users screen’s refusals', () => {
  const REASONS: Record<Extract<AdminUserResult, { ok: false }>['reason'], true> = {
    email_taken: true,
    last_admin: true,
    not_found: true,
    not_archived: true,
    confirm_email: true,
  };

  it('has a sentence for every refusal the query layer can return', () => {
    for (const reason of Object.keys(REASONS)) {
      expect(ADMIN_USERS_MESSAGES, reason).toHaveProperty(reason);
    }
  });

  it('shows every one of them in red, and no confirmation', () => {
    for (const reason of Object.keys(REASONS)) {
      expect(ADMIN_USERS_FAILURES.has(reason as keyof typeof ADMIN_USERS_MESSAGES), reason).toBe(
        true,
      );
    }

    // The other half of the same rule: the six things that went right are the
    // only keys that may expire on their own (`forms.ts` reads `data-tone`).
    for (const key of ['user_created', 'user_saved', 'user_password_set', 'user_archived', 'user_restored', 'user_purged'] as const) {
      expect(ADMIN_USERS_FAILURES.has(key), key).toBe(false);
    }
  });
});

/**
 * The size shown under each photo in the product editor. Worth pinning because
 * it changes unit twice, and the boundaries are where a wrong answer would be
 * least noticeable — «1024 КБ» and «0 КБ» both read as a bug in the panel.
 */
describe('formatFileSize', () => {
  it('shows bytes only below a kilobyte, where rounding would say 0 КБ', () => {
    expect(formatFileSize(0)).toBe('0 Б');
    expect(formatFileSize(1)).toBe('1 Б');
    expect(formatFileSize(1023)).toBe('1023 Б');
  });

  it('shows whole kilobytes up to a megabyte', () => {
    expect(formatFileSize(1024)).toBe('1 КБ');
    // A real file from the seeded catalog.
    expect(formatFileSize(204_608)).toBe('200 КБ');
    expect(formatFileSize(1023 * 1024)).toBe('1023 КБ');
  });

  it('never prints 1024 КБ on the way to a megabyte', () => {
    // 1023.999 KB rounds up to 1024, which is a megabyte spelled the long way.
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1 МБ');
  });

  it('shows one decimal above a megabyte, with the Ukrainian separator', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 МБ');
    expect(formatFileSize(1_572_864)).toBe('1,5 МБ');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 МБ');
  });
});
