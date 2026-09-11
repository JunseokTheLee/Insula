// VAPID 키 한 쌍을 만든다 (웹 푸시용). 외부 패키지 없이 Node 기본 crypto 만 쓴다.
//
//   node tools/generate-vapid-keys.js
//
// 나오는 두 값의 쓰임:
//   VAPID_PUBLIC_KEY  → 관리자 페이지 "사이트 옵션 → 푸시 알림 → 공개 키".
//                       브라우저가 구독할 때 쓰는 값이라 공개돼도 된다.
//   VAPID_PRIVATE_KEY → Supabase 비밀값. 저장소에 넣지 않는다 (CLAUDE.md 3절).
//                       supabase secrets set VAPID_PRIVATE_KEY=...
//
// 형식은 web-push 라이브러리(Edge Function 이 쓰는 것)와 같은
// URL-safe base64 다 — 공개 키는 비압축 P-256 점 65바이트, 비밀 키는 32바이트.
'use strict';

const { generateKeyPairSync } = require('crypto');

function b64url(base64urlOrBuffer) {
  const b = Buffer.isBuffer(base64urlOrBuffer) ? base64urlOrBuffer : Buffer.from(base64urlOrBuffer, 'base64url');
  return b.toString('base64url');
}

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });

// 비압축 점: 0x04 || X(32) || Y(32)
const publicKey = b64url(Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]));
const secretKey = b64url(jwk.d);

console.log('');
console.log('VAPID_PUBLIC_KEY  (관리자 사이트 옵션에 붙여넣기)');
console.log(publicKey);
console.log('');
console.log('VAPID_PRIVATE_KEY (Supabase 비밀값 — 저장소에 넣지 말 것)');
console.log(secretKey);
console.log('');
console.log('supabase secrets set \\');
console.log(`  VAPID_PUBLIC_KEY=${publicKey} \\`);
console.log(`  VAPID_PRIVATE_KEY=${secretKey} \\`);
console.log('  VAPID_SUBJECT=mailto:admin@weavo.art');
console.log('');
