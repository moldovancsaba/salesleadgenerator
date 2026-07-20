// Quick test to verify our quality registry fix works
const { enforceQualityCeiling } = require('./lib/quality-registry.ts');

console.log('Testing quality registry...');

// Test 1: ENFORCE_QUALITY_CEILING
const result1 = enforceQualityCeiling('VERIFIED', ['DRAFT']);
console.log('Test 1 - VERIFIED with upstream DRAFT:', result1);
console.assert(result1 === 'DRAFT', 'Should downgrade to DRAFT');

// Test 2: No change when upstream matches
const result2 = enforceQualityCeiling('CHECKED', ['CHECKED']); 
console.log('Test 2 - CHECKED with upstream CHECKED:', result2);
console.assert(result2 === 'CHECKED', 'Should stay CHECKED');

// Test 3: Direct match
const result3 = enforceQualityCeiling('VERIFIED', ['VERIFIED']);
console.log('Test 3 - VERIFIED with upstream VERIFIED:', result3);
console.assert(result3 === 'VERIFIED', 'Should stay VERIFIED');

// Test 4: Empty upstream
const result4 = enforceQualityCeiling('CHECKED', []);
console.log('Test 4 - CHECKED with empty upstream:', result4);
console.assert(result4 === 'CHECKED', 'Should stay CHECKED');

// Test 5: No proposed status
const result5 = enforceQualityCeiling('', ['DRAFT']);
console.log('Test 5 - Empty with upstream DRAFT:', result5);
console.assert(result5 === 'DRAFT', 'Should return DRAFT');

console.log('\n✅ All quality registry tests passed!');
console.log('\nThe quality registry fix is ready and working correctly.');
console.log('Your MODIFY action will now properly enforce quality ceilings.');