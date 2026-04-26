/**
 * Client-side keys aligned with DB functions normalize_borrower_phone / normalize_borrower_id_number
 * for in-file duplicate detection during import.
 */
import {
    isNationalIdIdentificationType,
    isVotersIdIdentificationType,
    isDriversLicenseIdentificationType,
    normalizeNidaDigits,
    normalizeDriversLicenseDigits,
    validateVotersIdentificationNumber,
} from './borrowerIdValidation';

export function normalizeBorrowerPhoneKey(p) {
    const v = String(p ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');
    return v || null;
}

export function normalizeBorrowerIdNumberKey(p) {
    const v = String(p ?? '').trim().toLowerCase();
    return v || null;
}

/** Canonical ID string for duplicate detection within an import file (match FCL). */
export function idKeyForImportDuplicateCheck(row) {
    if (isNationalIdIdentificationType(row.identification_type)) {
        return normalizeNidaDigits(row.identification_number);
    }
    if (isVotersIdIdentificationType(row.identification_type)) {
        const v = validateVotersIdentificationNumber(String(row.identification_number ?? ''));
        return v.ok ? v.value : String(row.identification_number ?? '');
    }
    if (isDriversLicenseIdentificationType(row.identification_type)) {
        return normalizeDriversLicenseDigits(row.identification_number);
    }
    return String(row.identification_number ?? '');
}

export function normalizeIdKey(p) {
    return String(p ?? '')
        .trim()
        .toLowerCase();
}

/**
 * True when identification_number was tagged by fix_duplicate_borrower_identification_numbers.sql
 * (value ends with ::<uuid>) — needs manual correction in the UI.
 */
export function identificationNumberNeedsDataReview(identificationNumber) {
    if (identificationNumber == null) return false;
    const s = String(identificationNumber).trim();
    return /::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** True when phone was tagged by fix_duplicate_borrower_phones.sql (…::<uuid> at end). */
export function phoneNumberNeedsDataReview(phoneNumber) {
    if (phoneNumber == null) return false;
    const s = String(phoneNumber).trim();
    return /::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function borrowerRowNeedsDataReview(borrower) {
    if (!borrower) return false;
    return (
        identificationNumberNeedsDataReview(borrower.identification_number) ||
        phoneNumberNeedsDataReview(borrower.phone_number)
    );
}

/** True when this row is a stored duplicate of another borrower (DB column duplicate_of_borrower_id). */
export function borrowerRowIsDuplicateRecord(borrower) {
    if (!borrower) return false;
    return Boolean(borrower.duplicate_of_borrower_id);
}

/**
 * Which fields match the main (canonical) row — same logic as DB normalize phone / ID keys.
 * Returns a short line for the UI, or empty string if we cannot tell (e.g. missing canonical fields).
 */
export function duplicateRowMatchSummary(duplicateRow, canonicalBorrower) {
    if (!duplicateRow || !canonicalBorrower) return '';
    const samePhone =
        normalizeBorrowerPhoneKey(duplicateRow.phone_number) != null &&
        normalizeBorrowerPhoneKey(duplicateRow.phone_number) ===
            normalizeBorrowerPhoneKey(canonicalBorrower.phone_number);
    const sameId =
        normalizeBorrowerIdNumberKey(duplicateRow.identification_number) != null &&
        normalizeBorrowerIdNumberKey(duplicateRow.identification_number) ===
            normalizeBorrowerIdNumberKey(canonicalBorrower.identification_number);
    if (!samePhone && !sameId) return '';
    if (samePhone && sameId) {
        return 'Same phone and ID as main record';
    }
    if (samePhone) {
        return 'Same phone as main record';
    }
    return 'Same ID as main record';
}
