const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname,'../supabase/migrations/0006_spn_phase1.sql'),'utf8');
test('phase 1 is additive and preserves existing booking and payment tables',()=>{
 assert.match(sql,/alter table public\.partner add column if not exists partner_code/);
 assert.doesNotMatch(sql,/\bdrop table\b|\btruncate\b|\bdelete from\b/i);
 assert.doesNotMatch(sql,/alter table public\.(booking|payment)\b/i);
});
test('referrals enforce one booking claim and staff-only access',()=>{
 assert.match(sql,/partner_referral_booking_unique/);
 assert.match(sql,/partner_referral enable row level security/);
 assert.match(sql,/spn_referral_insert[\s\S]*?public\.is_staff\(\)/);
});
test('commission entries are owner-only with direct booking uniqueness',()=>{
 assert.match(sql,/partner_commission_one_direct/);
 assert.match(sql,/spn_commission_write[\s\S]*?public\.is_owner\(\)/);
 assert.doesNotMatch(sql,/grant[^;]*delete/i);
});
