// lib/customerMerge.js
// Customer data normalization, merging, and deduplication utilities

/**
 * Normalize phone number to E.164 format
 * Falls back to cleaning digits if parsing fails
 * @param {string} phone - Raw phone number
 * @param {string} defaultCountry - Default country code (KW for Kuwait, SA for Saudi)
 * @returns {string|null} - Normalized E.164 phone or null
 */
function normalizePhone(phone, defaultCountry = 'KW') {
  if (!phone || typeof phone !== 'string') return null;
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  if (!digitsOnly) return null;
  
  // Kuwait numbers: +965 followed by 8 digits
  // Saudi numbers: +966 followed by 9 digits
  
  // Already has country code
  if (digitsOnly.startsWith('965') && digitsOnly.length === 11) {
    return '+' + digitsOnly;
  }
  if (digitsOnly.startsWith('966') && digitsOnly.length === 12) {
    return '+' + digitsOnly;
  }
  
  // Add country code based on default
  if (defaultCountry === 'KW' && digitsOnly.length === 8) {
    return '+965' + digitsOnly;
  }
  if (defaultCountry === 'SA' && digitsOnly.length === 9) {
    return '+966' + digitsOnly;
  }
  
  // If starts with 0, remove it and try again
  if (digitsOnly.startsWith('0')) {
    const withoutZero = digitsOnly.substring(1);
    if (defaultCountry === 'KW' && withoutZero.length === 8) {
      return '+965' + withoutZero;
    }
    if (defaultCountry === 'SA' && withoutZero.length === 9) {
      return '+966' + withoutZero;
    }
  }
  
  // Fallback: return as-is with + if it looks international
  if (digitsOnly.length >= 10) {
    return '+' + digitsOnly;
  }
  
  return null;
}

/**
 * Parse Foodics unique ID from customer name
 * Foodics names often contain embedded IDs in formats like:
 * "Customer Name | 12345" or "12345 - Customer Name" or "(12345) Customer Name"
 * @param {string} name - Customer name from Foodics
 * @returns {string|null} - Extracted unique ID or null
 */
function parseFoodicsUniqueIdFromName(name) {
  if (!name || typeof name !== 'string') return null;
  
  // Pattern 1: "Name | ID"
  const pipeMatch = name.match(/\|\s*([A-Z0-9]{4,})\s*$/i);
  if (pipeMatch) return pipeMatch[1].toUpperCase();
  
  // Pattern 2: "ID - Name"
  const dashMatch = name.match(/^([A-Z0-9]{4,})\s*-\s*/i);
  if (dashMatch) return dashMatch[1].toUpperCase();
  
  // Pattern 3: "(ID) Name"
  const parenMatch = name.match(/^\(([A-Z0-9]{4,})\)\s*/i);
  if (parenMatch) return parenMatch[1].toUpperCase();
  
  // Pattern 4: "Name [ID]"
  const bracketMatch = name.match(/\[\s*([A-Z0-9]{4,})\s*\]$/i);
  if (bracketMatch) return bracketMatch[1].toUpperCase();
  
  return null;
}

/**
 * Build deterministic merge key for deduplication
 * Priority: Foodics unique ID > Phone number > DataTech customer ID > Name-based ID
 * @param {object} ids - Object containing identifiers
 * @param {string} name - Customer name (optional, for extracting ID as last resort)
 * @returns {string} - Merge key
 */
function buildMergeKey({ foodics_unique_id, phone_normalized, datatech_customer_id }, name = null) {
  if (foodics_unique_id) {
    return `fuid:${foodics_unique_id}`;
  }
  if (phone_normalized) {
    return `phone:${phone_normalized}`;
  }
  if (datatech_customer_id) {
    return `dtid:${datatech_customer_id}`;
  }
  
  // Try to extract ID from name as fallback
  if (name) {
    const nameId = parseFoodicsUniqueIdFromName(name);
    if (nameId) {
      return `nameid:${nameId}`;
    }
  }
  
  // Last resort: generate random key (should rarely happen)
  return `unknown:${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Merge customer records from Foodics and DataTech
 * Foodics data takes precedence; DataTech fills missing fields
 * @param {object} foodics - Foodics customer data
 * @param {object} datatech - DataTech customer data
 * @returns {object} - Merged customer record
 */
function mergeCustomerRecords(foodics, datatech) {
  const has_foodics = !!foodics;
  const has_datatech = !!datatech;
  
  // Determine source
  let source;
  if (has_foodics && has_datatech) {
    source = 'Merged';
  } else if (has_foodics) {
    source = 'Foodics';
  } else {
    source = 'DataTech';
  }
  
  // Merge with Foodics priority
  return {
    // Source tracking
    source,
    has_foodics,
    has_datatech,
    
    // Identifiers
    foodics_id: foodics?.foodics_id || null,
    foodics_unique_id: foodics?.foodics_unique_id || null,
    datatech_customer_id: datatech?.datatech_customer_id || null,
    
    // Core identity - Foodics priority, DataTech fills
    name: foodics?.name || datatech?.name || null,
    phone_raw: foodics?.phone_raw || datatech?.phone_raw || null,
    phone_normalized: foodics?.phone_normalized || datatech?.phone_normalized || null,
    email: foodics?.email || datatech?.email || null,
  };
}

/**
 * Safe number conversion with default
 * @param {any} value - Value to convert
 * @param {number} defaultValue - Default if conversion fails
 * @returns {number}
 */
function safeNumber(value, defaultValue = 0) {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Safe date conversion
 * @param {any} value - Value to convert
 * @returns {Date|null}
 */
function safeDate(value) {
  if (!value) return null;
  
  // Already a Date
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  
  // String or timestamp
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Calculate months between two dates
 * @param {Date} start 
 * @param {Date} end 
 * @returns {number}
 */
function monthsBetween(start, end) {
  if (!start || !end) return 0;
  
  const startDate = safeDate(start);
  const endDate = safeDate(end);
  
  if (!startDate || !endDate) return 0;
  
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 
    + (endDate.getMonth() - startDate.getMonth())
    + (endDate.getDate() - startDate.getDate()) / 30;
  
  return Math.max(0, months);
}

/**
 * Calculate days between two dates
 * @param {Date} start 
 * @param {Date} end 
 * @returns {number}
 */
function daysBetween(start, end) {
  if (!start || !end) return 0;
  
  const startDate = safeDate(start);
  const endDate = safeDate(end);
  
  if (!startDate || !endDate) return 0;
  
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

module.exports = {
  normalizePhone,
  parseFoodicsUniqueIdFromName,
  buildMergeKey,
  mergeCustomerRecords,
  safeNumber,
  safeDate,
  monthsBetween,
  daysBetween
};
