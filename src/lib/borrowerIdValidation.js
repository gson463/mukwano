/** Tanzania NIDA / NIN is 20 numeric digits. Display chunks: ########-#####-#####-## */
export const NIDA_DIGIT_LENGTH = 20;

const NIDA_SEGMENT_LENGTHS = [8, 5, 5, 2];

/** With hyphens, e.g. 19730701-33201-00006-12 */
export const NIDA_MAX_DISPLAY_LENGTH =
    NIDA_DIGIT_LENGTH + (NIDA_SEGMENT_LENGTHS.length - 1);

/** Alias for callers (matches voter ID naming) */
export const NIDA_MAX_INPUT_LENGTH = NIDA_MAX_DISPLAY_LENGTH;

/** Strip to digits only (for storage keys, duplicate checks, backward compat.) */
export function normalizeNidaDigits(raw) {
    return String(raw ?? '').replace(/\D/g, '');
}

/** Up to 20 digits extracted from pasted or typed value (hyphens stripped). */
export function extractNidaDigitsBody(raw) {
    return normalizeNidaDigits(raw).slice(0, NIDA_DIGIT_LENGTH);
}

/**
 * Display NIDA as you type: ####-..., full e.g. 19730701-33201-00006-12
 * @param {string} digitBody 0..20 digits only
 */
export function formatNidaDisplay(digitBody) {
    const d = extractNidaDigitsBody(digitBody);
    if (d.length === 0) return '';
    const parts = [];
    let pos = 0;
    for (const len of NIDA_SEGMENT_LENGTHS) {
        if (pos >= d.length) break;
        const take = Math.min(len, d.length - pos);
        parts.push(d.slice(pos, pos + take));
        pos += take;
    }
    return parts.join('-');
}

/** Live input: auto-insert hyphens for NIDA. */
export function normalizeNidaInput(raw) {
    return formatNidaDisplay(extractNidaDigitsBody(raw));
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateNidaIdentificationNumber(raw) {
    const digits = normalizeNidaDigits(raw);
    if (digits.length !== NIDA_DIGIT_LENGTH) {
        const suffix = digits.length > 0 ? ` You entered ${digits.length}.` : '';
        return {
            ok: false,
            error: `National ID (NIDA) must be exactly ${NIDA_DIGIT_LENGTH} digits (e.g. 19730701-33201-00006-12) — not less, not more.${suffix}`,
        };
    }
    return { ok: true, value: digits };
}

/** True when ID type is Tanzania National ID (NIDA) */
export function isNationalIdIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return s === 'national_id' || s === 'national id' || s === 'nida';
}

/** NEC-style voter number: T + exactly 12 digits. Display: T-####-####-###-#. */
export const VOTERS_ID_DIGIT_COUNT = 12;

const VOTERS_ID_PREFIX = 'T';

const VOTERS_ID_SEGMENT_LENGTHS = [4, 4, 3, 1];

/** Display max length when hyphens shown, e.g. T-1004-9792-964-9 */
export const VOTERS_ID_MAX_DISPLAY_LENGTH =
    VOTERS_ID_PREFIX.length +
    1 +
    VOTERS_ID_SEGMENT_LENGTHS.reduce((a, b) => a + b, 0) +
    (VOTERS_ID_SEGMENT_LENGTHS.length - 1);

/** Prefer `VOTERS_ID_MAX_DISPLAY_LENGTH`; kept for callers using the old export name */
export const VOTERS_ID_MAX_INPUT_LENGTH = VOTERS_ID_MAX_DISPLAY_LENGTH;

/**
 * Digits-only body (max 12) after T. If raw starts with T/t, digits are taken after that letter only (avoids doubling when pasting “T…” + digits).
 * Otherwise all digits up to 12 (e.g. paste of 12 digits only).
 */
export function extractVotersIdDigits(raw) {
    const s = String(raw ?? '').trim().replace(/\s/g, '');
    if (s.length === 0) return '';
    if (/^[tT]/.test(s)) {
        return s
            .slice(1)
            .replace(/\D/g, '')
            .slice(0, VOTERS_ID_DIGIT_COUNT);
    }
    return s.replace(/\D/g, '').slice(0, VOTERS_ID_DIGIT_COUNT);
}

/**
 * As-you-type format: `T`, `T-1004`, …, `T-1004-9792-964-9`.
 * @param {string} digitBody 0..12 digits only
 */
export function formatVotersIdDisplay(digitBody) {
    const d = String(digitBody ?? '').replace(/\D/g, '').slice(0, VOTERS_ID_DIGIT_COUNT);
    if (d.length === 0) return VOTERS_ID_PREFIX;

    const parts = [];
    let pos = 0;
    for (const len of VOTERS_ID_SEGMENT_LENGTHS) {
        if (pos >= d.length) break;
        const take = Math.min(len, d.length - pos);
        parts.push(d.slice(pos, pos + take));
        pos += take;
    }
    return `${VOTERS_ID_PREFIX}-${parts.join('-')}`;
}

/**
 * Normalize live input — hyphens inserted automatically while typing/pasting.
 * @param {string} raw
 */
export function normalizeVotersIdInput(raw) {
    return formatVotersIdDisplay(extractVotersIdDigits(raw));
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateVotersIdentificationNumber(raw) {
    const digits = extractVotersIdDigits(String(raw ?? '').replace(/\s/g, ''));
    if (digits.length !== VOTERS_ID_DIGIT_COUNT) {
        const suffix =
            digits.length > 0
                ? ` You have ${digits.length} digit(s) (need exactly ${VOTERS_ID_DIGIT_COUNT}).`
                : '';
        return {
            ok: false,
            error: `Voter's ID must start with T and have exactly ${VOTERS_ID_DIGIT_COUNT} digits, e.g. T-####-####-###-#.${suffix}`,
        };
    }
    return { ok: true, value: `${VOTERS_ID_PREFIX}${digits}` };
}

/** True when ID type is Voter's ID (NEC) */
export function isVotersIdIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return s === 'voters_id' || s === "voter's id" || s === 'voters id' || s === 'voter id';
}

/**
 * Pretty-print canonical values from the DB for read-only UI (exports, tables).
 * Storage stays compact (no hyphens); this only affects display strings.
 */
export function formatStoredIdentificationForDisplay(identification_type, identification_number) {
    const raw = identification_number == null ? '' : String(identification_number).trim();
    if (!raw) return '';

    if (isNationalIdIdentificationType(identification_type)) {
        return normalizeNidaInput(raw);
    }
    if (isVotersIdIdentificationType(identification_type)) {
        return normalizeVotersIdInput(raw);
    }
    return raw;
}

/**
 * Tanzania TRA driving licence (CDLS): public format varies; we enforce a fixed numeric length for data quality.
 * Change DRIVER_LICENSE_DIGIT_LENGTH if your branch uses a different TRA rule.
 */
export const DRIVER_LICENSE_DIGIT_LENGTH = 10;

export function normalizeDriversLicenseDigits(raw) {
    return String(raw ?? '').replace(/\D/g, '').slice(0, DRIVER_LICENSE_DIGIT_LENGTH);
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateDriversLicenseIdentificationNumber(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length !== DRIVER_LICENSE_DIGIT_LENGTH) {
        const suffix = digits.length > 0 ? ` You entered ${digits.length}.` : '';
        return {
            ok: false,
            error: `Driver's license number must be exactly ${DRIVER_LICENSE_DIGIT_LENGTH} digits (numbers only) — not less, not more.${suffix}`,
        };
    }
    return { ok: true, value: digits };
}

export function isDriversLicenseIdentificationType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    return (
        s === 'drivers_license' ||
        s === "driver's license" ||
        s === 'drivers license' ||
        s === 'driving licence' ||
        s === 'driving license'
    );
}

/** Local mobile: exactly 10 digits */
export const PHONE_DIGIT_LENGTH = 10;

export function normalizePhoneDigitsMax10(raw) {
    return String(raw ?? '')
        .replace(/\D/g, '')
        .slice(0, PHONE_DIGIT_LENGTH);
}

export function validatePhoneNumberTenDigits(raw) {
    const d = normalizePhoneDigitsMax10(raw);
    if (d.length !== PHONE_DIGIT_LENGTH) {
        return {
            ok: false,
            error: `Phone must be exactly ${PHONE_DIGIT_LENGTH} digits (numbers only).`,
        };
    }
    return { ok: true, value: d };
}

/** First name, surname: letters, spaces, hyphen, apostrophe only */
export function normalizePersonNameLettersOnly(raw) {
    return String(raw ?? '').replace(/[^\p{L}\s'-]/gu, '');
}
