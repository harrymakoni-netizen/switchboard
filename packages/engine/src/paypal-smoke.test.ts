import { it, expect, vi } from "vitest";
import { MockPayPal } from "@switchboard/paypal";
import {
  newSmokeState,
  preparePayPalSmoke,
  resumePayPalSmoke,
} from "./paypal-smoke";
it("requires separate completion approval before smoke capture and payout", async () => {
  const paypal = new MockPayPal();
  const capture = vi.spyOn(paypal, "capture");
  const payout = vi.spyOn(paypal, "createPayout");
  const state = newSmokeState();
  const persist = vi.fn(async () => {});
  await preparePayPalSmoke(paypal, state, "http://localhost:3000", persist);
  await resumePayPalSmoke(paypal, state, { confirmDone: false }, persist);
  expect(state.cancel.voided).toBe(true);
  expect(state.capture.authorizationId).toBeTruthy();
  expect(capture).not.toHaveBeenCalled();
  expect(payout).not.toHaveBeenCalled();
  await resumePayPalSmoke(
    paypal,
    state,
    { confirmDone: true, payoutEmail: "sandbox@example.com" },
    persist,
  );
  expect(state.capture.captureId).toBeTruthy();
  expect(state.payout?.status).toBe("SUCCEEDED");
  expect(capture).toHaveBeenCalledTimes(1);
  expect(payout).toHaveBeenCalledTimes(1);
  await resumePayPalSmoke(
    paypal,
    state,
    { confirmDone: true, payoutEmail: "sandbox@example.com" },
    persist,
  );
  expect(capture).toHaveBeenCalledTimes(1);
  expect(payout).toHaveBeenCalledTimes(1);
  await expect(
    resumePayPalSmoke(
      paypal,
      state,
      { confirmDone: true, payoutEmail: "changed@example.com" },
      persist,
    ),
  ).rejects.toThrow(/recipient/);
});
