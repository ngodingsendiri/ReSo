/**
 * Lightweight matching regression checks (run: npx tsx src/lib/matching.test.ts)
 */
import { matchEmployeesToEngagement, engagedIdsEqual, mergeUniqueLines } from './matching';

const employees = [
  {
    id: 'e1',
    name: 'Budi Santoso',
    igUsername: '@budi_s',
    igUsername2: 'budi.alt',
    fbName: 'Budi Santoso FB',
    tiktokName: '@buditk',
  },
  {
    id: 'e2',
    name: 'Siti Aminah',
    igUsername: 'siti_aminah',
    fbName: 'Siti Aminah',
    tiktokName: 'siti.tt',
  },
  {
    id: 'e3',
    name: 'Andi Wijaya',
    igUsername: 'andiw',
  },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

// IG username match
assert(
  matchEmployeesToEngagement('budi_s\nsomeone_else', employees, 'ig').includes('e1'),
  'IG primary username'
);
assert(
  matchEmployeesToEngagement('budi.alt', employees, 'ig').includes('e1'),
  'IG secondary username'
);
assert(
  matchEmployeesToEngagement('@siti_aminah', employees, 'ig').includes('e2'),
  'IG with @ strip on master'
);

// Full name in paste
assert(
  matchEmployeesToEngagement('Budi Santoso liked this', employees, 'ig').includes('e1'),
  'Full name in blob'
);

// FB
assert(
  matchEmployeesToEngagement('Budi Santoso FB', employees, 'fb').includes('e1'),
  'FB display name'
);

// TikTok
assert(
  matchEmployeesToEngagement('buditk\nsiti.tt', employees, 'tiktok').includes('e1') &&
    matchEmployeesToEngagement('buditk\nsiti.tt', employees, 'tiktok').includes('e2'),
  'TikTok multi-line'
);

// No false match empty
assert(matchEmployeesToEngagement('', employees, 'ig').length === 0, 'Empty input');
assert(matchEmployeesToEngagement('random_xyz_99', employees, 'ig').length === 0, 'No false positive random');

// engagedIdsEqual order-independent
assert(engagedIdsEqual(['a', 'b'], ['b', 'a']), 'IDs equal unordered');
assert(!engagedIdsEqual(['a'], ['a', 'b']), 'IDs unequal length');

// FB secondary + name-only TikTok path
assert(
  matchEmployeesToEngagement('Siti Aminah', employees, 'fb').includes('e2'),
  'FB match by name field'
);
assert(
  !matchEmployeesToEngagement('andiw', employees, 'fb').includes('e3'),
  'IG handle not matched on FB platform'
);
assert(
  matchEmployeesToEngagement('ANDI WIJAYA', employees, 'tiktok').includes('e3'),
  'Name match case-insensitive on TikTok'
);
assert(
  matchEmployeesToEngagement('  @budi_s  \n', employees, 'ig').includes('e1'),
  'Whitespace around username'
);

// Short-token false positive guard
const shortEmp = [{ id: 's1', name: 'Li', igUsername: 'li' }];
assert(
  !matchEmployeesToEngagement('malicious', shortEmp, 'ig').includes('s1'),
  'Short token not false-positive inside longer word'
);
assert(
  matchEmployeesToEngagement('li', shortEmp, 'ig').includes('s1'),
  'Short token exact still matches'
);

// mergeUniqueLines
assert(
  mergeUniqueLines('a\nb', ['B', 'c']) === 'a\nb\nc',
  'mergeUniqueLines case-insensitive dedupe'
);

console.log('\nAll matching tests passed.');
