import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { assertNotEquals } from "https://deno.land/std@0.208.0/assert/assert_not_equals.ts";
import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { assertFalse } from "https://deno.land/std@0.208.0/assert/assert_false.ts";

import * as auth from "./auth.ts";

Deno.test({
  name: "hash password",
  async fn() {
    const plaintext = "mycoolpassword";
    const salt = await auth.generateSalt();

    const hash0 = await auth.hashPassword(plaintext, salt);
    const hash1 = await auth.hashPassword(plaintext, salt);

    assertEquals(hash0, hash1);

    const hash2 = await auth.hashPassword(plaintext);
    const hash3 = await auth.hashPassword(plaintext);

    assertNotEquals(hash2, hash3);
  }
});

Deno.test({
  name: "compare passwords",
  async fn() {
    const plaintext = "mycoolpassword";

    const hash0 = await auth.hashPassword(plaintext);

    assert(await auth.comparePasswords(plaintext, hash0));
    assertFalse(await auth.comparePasswords("bad password", hash0));
  }
});

Deno.test({
  name: "create and verify jwt",
  async fn() {
    const issuer = "a cool dev";

    const jwt0 = await auth.createJwt(issuer, 0);
    await new Promise((r) => setTimeout(r, 1000));
    const jwt1 = await auth.createJwt(issuer, 0);

    assertFalse(jwt0 === jwt1);
    assert(await auth.verifyJwt(jwt0) !== null);
    assert(await auth.verifyJwt(jwt1)) !== null;
  }
});

Deno.test({
  name: "invalid jwt",
  async fn() {
    const jwt0 = await auth.createJwt("me :)", 0, { expiration: 0 });
    assert(await auth.verifyJwt(jwt0) === null);
  }
})
