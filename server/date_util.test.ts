import { assertEquals } from "https://deno.land/std@0.208.0/assert/assert_equals.ts";
import { timeBetween } from "./date_util.ts";

Deno.test({
  name: "time between as milliseconds",
  fn() {
    const d0 = new Date(0);
    const d1 = new Date(1001);

    assertEquals(timeBetween("MILLISECONDS", d0, d1), 1001);
  }
});

Deno.test({
  name: "time between as seconds",
  fn() {
    const d0 = new Date(1000);
    const d1 = new Date(3000);

    assertEquals(timeBetween("SECONDS", d0, d1), 2);
  }
});

Deno.test({
  name: "time between as minutes",
  fn() {
    const d0 = new Date(1000);
    const d1 = new Date(181000);

    assertEquals(timeBetween("MINUTES", d0, d1), 3);
  }
});

Deno.test({
  name: "time between as hours",
  fn() {
    const d0 = new Date(1000);
    const d1 = new Date(14401000);

    assertEquals(timeBetween("HOURS", d0, d1), 4)
  }
});

Deno.test({
  name: "time between as days",
  fn() {
    const d0 = new Date(1000);
    const d1 = new Date(432001000);

    assertEquals(timeBetween("DAYS", d0, d1), 5);
  }
});
