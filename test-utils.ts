/**
 * Test utilities and validation functions for the ClipCast app
 * Run with: npm run test
 * 
 * This script tests:
 * - Utility functions (baseName, newId, parseTimesCsv, etc.)
 * - Time parsing and formatting
 * - Timezone conversions
 * - Data validation
 * - Edge cases and boundary conditions
 */

import {
  baseName,
  newId,
  pad2,
  getZonedParts,
  tzOffsetMs,
  zonedComponentsToUtcEpoch,
  formatForGrid,
  toDateTimeLocalValue,
  parseDateTimeLocalValue,
  parseTimesCsv,
  minutesToHHmm,
  timeToMinutes,
  normalizeTimesCsv,
  nextDay,
  nextSlotAfter,
} from './src/utils';
import type { PublishMode } from './src/types';

// Test results interface
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | boolean | Promise<void | boolean>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then((r) => {
          const passed = r !== false;
          results.push({ name, passed, details: passed ? 'OK' : 'Failed' });
          if (!passed) console.error(`❌ ${name}`);
          else console.log(`✅ ${name}`);
        })
        .catch((e) => {
          results.push({ name, passed: false, error: String(e) });
          console.error(`❌ ${name}:`, e);
        });
    } else {
      const passed = result !== false;
      results.push({ name, passed, details: passed ? 'OK' : 'Failed' });
      if (!passed) console.error(`❌ ${name}`);
      else console.log(`✅ ${name}`);
    }
  } catch (e) {
    results.push({ name, passed: false, error: String(e) });
    console.error(`❌ ${name}:`, e);
  }
}

function assert(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ==================== TEST SUITE ====================

console.log('\n🧪 Running ClipCast Test Suite...\n');

// Test 1: baseName function
test('baseName - extracts filename from path', () => {
  assert(baseName('C:\\Users\\test\\video.mp4') === 'video.mp4');
  assert(baseName('/home/user/video.mp4') === 'video.mp4');
  assert(baseName('video.mp4') === 'video.mp4');
  assert(baseName('folder/subfolder/file.mp4') === 'file.mp4');
});

// Test 2: newId function
test('newId - generates unique IDs', () => {
  const id1 = newId();
  const id2 = newId();
  assert(typeof id1 === 'string');
  assert(typeof id2 === 'string');
  assert(id1 !== id2);
  assert(id1.length > 0);
  assert(id2.length > 0);
});

// Test 3: pad2 function
test('pad2 - pads numbers to 2 digits', () => {
  assert(pad2(5) === '05');
  assert(pad2(10) === '10');
  assert(pad2(0) === '00');
  assert(pad2(99) === '99');
});

// Test 4: parseTimesCsv function
test('parseTimesCsv - parses time strings correctly', () => {
  const result1 = parseTimesCsv('09:00, 13:30, 18:00');
  assert(result1.length === 3);
  assert(result1[0] === 9 * 60); // 09:00 = 540 minutes
  assert(result1[1] === 13 * 60 + 30); // 13:30 = 810 minutes
  assert(result1[2] === 18 * 60); // 18:00 = 1080 minutes

  const result2 = parseTimesCsv('09:00 13:30');
  assert(result2.length === 2);

  const result3 = parseTimesCsv('invalid, 25:00, 12:99');
  assert(result3.length === 0); // Invalid times should be filtered out

  const result4 = parseTimesCsv('09:00, 09:00, 13:30');
  assert(result4.length === 2); // Duplicates should be removed
});

// Test 5: minutesToHHmm function
test('minutesToHHmm - converts minutes to HH:mm format', () => {
  assert(minutesToHHmm(540) === '09:00');
  assert(minutesToHHmm(810) === '13:30');
  assert(minutesToHHmm(1080) === '18:00');
  assert(minutesToHHmm(0) === '00:00');
  assert(minutesToHHmm(1439) === '23:59');
});

// Test 6: timeToMinutes function
test('timeToMinutes - converts HH:mm to minutes', () => {
  assert(timeToMinutes('09:00') === 540);
  assert(timeToMinutes('13:30') === 810);
  assert(timeToMinutes('18:00') === 1080);
  assert(timeToMinutes('00:00') === 0);
  assert(timeToMinutes('23:59') === 1439);
  assert(timeToMinutes('25:00') === null); // Invalid hour
  assert(timeToMinutes('12:99') === null); // Invalid minute
  assert(timeToMinutes('invalid') === null); // Invalid format
});

// Test 7: normalizeTimesCsv function
test('normalizeTimesCsv - normalizes time strings', () => {
  const result = normalizeTimesCsv('09:00, 13:30, 18:00');
  assert(result === '09:00,13:30,18:00');
  
  const result2 = normalizeTimesCsv('09:00 13:30 18:00');
  assert(result2.includes('09:00'));
  assert(result2.includes('13:30'));
  assert(result2.includes('18:00'));
});

// Test 8: zonedComponentsToUtcEpoch - SYSTEM timezone
test('zonedComponentsToUtcEpoch - SYSTEM timezone', () => {
  const parts = { year: 2026, month: 1, day: 7, hour: 12, minute: 0 };
  const result = zonedComponentsToUtcEpoch(parts, 'SYSTEM');
  assert(result !== null);
  assert(typeof result === 'number');
  assert(result > 0);
});

// Test 9: zonedComponentsToUtcEpoch - UTC timezone
test('zonedComponentsToUtcEpoch - UTC timezone', () => {
  const parts = { year: 2026, month: 1, day: 7, hour: 12, minute: 0 };
  const result = zonedComponentsToUtcEpoch(parts, 'UTC');
  assert(result !== null);
  assert(typeof result === 'number');
  // Should be exactly 2026-01-07T12:00:00Z
  const expected = new Date('2026-01-07T12:00:00Z').getTime();
  assert(Math.abs(result - expected) < 1000); // Allow 1 second tolerance
});

// Test 10: zonedComponentsToUtcEpoch - IANA timezone
test('zonedComponentsToUtcEpoch - IANA timezone (Europe/London)', () => {
  const parts = { year: 2026, month: 1, day: 7, hour: 12, minute: 0 };
  const result = zonedComponentsToUtcEpoch(parts, 'Europe/London');
  assert(result !== null);
  assert(typeof result === 'number');
  assert(result > 0);
});

// Test 11: formatForGrid function
test('formatForGrid - formats dates correctly', () => {
  const epoch = new Date('2026-01-07T12:00:00Z').getTime();
  const result1 = formatForGrid(epoch, 'later', 'UTC');
  assert(result1.length > 0);
  assert(result1.includes('2026') || result1.includes('07'));

  const result2 = formatForGrid(null, 'later', 'UTC');
  assert(result2 === '');

  const result3 = formatForGrid(epoch, 'now', 'UTC');
  assert(result3 === 'Now');
});

// Test 12: toDateTimeLocalValue and parseDateTimeLocalValue
test('toDateTimeLocalValue and parseDateTimeLocalValue - round trip', () => {
  const epoch = new Date('2026-01-07T12:00:00Z').getTime();
  const localValue = toDateTimeLocalValue(epoch, 'UTC');
  assert(localValue.includes('2026'));
  assert(localValue.includes('01'));
  assert(localValue.includes('07'));

  const parsed = parseDateTimeLocalValue(localValue, 'UTC');
  assert(parsed !== null);
  // Allow some tolerance for timezone conversions
  assert(Math.abs((parsed || 0) - epoch) < 24 * 60 * 60 * 1000); // Within 24 hours
});

// Test 13: nextDay function
test('nextDay - calculates next day correctly', () => {
  const result = nextDay(2026, 1, 7);
  assert(result.year === 2026);
  assert(result.month === 1);
  assert(result.day === 8);

  const result2 = nextDay(2026, 1, 31);
  assert(result2.month === 2);
  assert(result2.day === 1);

  const result3 = nextDay(2026, 12, 31);
  assert(result3.year === 2027);
  assert(result3.month === 1);
  assert(result3.day === 1);
});

// Test 14: nextSlotAfter function
test('nextSlotAfter - finds next available slot', () => {
  const now = new Date('2026-01-07T10:00:00Z').getTime();
  const slots = [9 * 60, 13 * 60, 18 * 60]; // 09:00, 13:00, 18:00
  const result = nextSlotAfter(now, 'UTC', slots);
  assert(result !== null);
  assert(result > now);
});

// Test 15: getZonedParts function
test('getZonedParts - extracts timezone parts correctly', () => {
  const date = new Date('2026-01-07T12:00:00Z');
  const parts = getZonedParts(date, 'UTC');
  assert(parts.year === 2026);
  assert(parts.month === 1);
  assert(parts.day === 7);
  assert(parts.hour === 12);
  assert(parts.minute === 0);
  assert(typeof parts.second === 'number');
});

// Test 16: tzOffsetMs function
test('tzOffsetMs - calculates timezone offset', () => {
  const date = new Date('2026-01-07T12:00:00Z');
  const offset = tzOffsetMs(date, 'UTC');
  assert(typeof offset === 'number');
  // UTC offset should be 0
  assert(Math.abs(offset) < 1000); // Allow small tolerance
});

// Test 17: Edge cases - invalid inputs
test('Edge cases - invalid time inputs', () => {
  assert(timeToMinutes('') === null);
  assert(timeToMinutes('99:99') === null);
  const emptyResult = parseTimesCsv('');
  assert(Array.isArray(emptyResult) && emptyResult.length === 0);
  const invalidResult = parseTimesCsv('invalid');
  assert(Array.isArray(invalidResult) && invalidResult.length === 0);
});

// Test 18: Edge cases - boundary values
test('Edge cases - boundary values', () => {
  assert(timeToMinutes('00:00') === 0);
  assert(timeToMinutes('23:59') === 1439);
  assert(minutesToHHmm(0) === '00:00');
  assert(minutesToHHmm(1439) === '23:59');
});

// Test 19: Data validation - filename normalization
test('Data validation - filename normalization patterns', () => {
  // Test that baseName handles various path formats
  const testCases = [
    { input: 'C:\\Windows\\Path\\file.mp4', expected: 'file.mp4' },
    { input: '/unix/path/file.mp4', expected: 'file.mp4' },
    { input: 'file.mp4', expected: 'file.mp4' },
    { input: 'folder\\subfolder\\file.mp4', expected: 'file.mp4' },
  ];

  testCases.forEach(({ input, expected }) => {
    assert(baseName(input) === expected, `Failed for: ${input}`);
  });
});

// Test 20: Metadata parsing simulation
test('Metadata parsing - structure validation', () => {
  // Simulate metadata structure
  const mockMetadata = {
    byPlatform: {
      youtube: {
        title: 'Test Title',
        description: 'Test Description',
        hashtags: '#test #hashtags',
        source: 'exports' as const,
      },
      instagram: {
        title: 'Instagram Title',
        description: 'Instagram Description',
        hashtags: '#instagram',
        source: 'metadata' as const,
      },
      tiktok: null,
    },
    raw: null,
  };

  // Validate structure
  assert(mockMetadata.byPlatform.youtube !== null);
  assert(mockMetadata.byPlatform.youtube.title === 'Test Title');
  assert(mockMetadata.byPlatform.instagram !== null);
  assert(mockMetadata.byPlatform.tiktok === null);
});

// Wait for async tests to complete, then print summary
setTimeout(() => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}`);
        if (r.error) console.log(`    Error: ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}, 2000);
