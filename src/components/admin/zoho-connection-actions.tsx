"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cancelZohoReconnect, disconnectZoho, testZohoConnection } from "@/lib/actions/zoho-integration";

export function ZohoConnectionActions({ connected, pendingSetup, canTest }: { connected: boolean; pendingSetup: boolean; canTest: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<"cancel" | "disconnect" | null>(null);

  if (!connected && !pendingSetup) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canTest && <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
        try { const result = await testZohoConnection(); toast.success(result.status === "connected" ? "Zoho Books connection verified" : "Zoho Books is only partially connected"); router.refresh(); }
        catch (error) { toast.error(error instanceof Error ? error.message : "Could not verify Zoho Books"); }
      })}>{pending ? "Testing…" : "Test connection"}</Button>}
      {pendingSetup && !confirmation && <Button type="button" variant="outline" onClick={() => setConfirmation("cancel")}>{connected ? "Cancel reconnect" : "Cancel setup"}</Button>}
      {connected && !confirmation && <Button type="button" variant="destructive" onClick={() => setConfirmation("disconnect")}>Disconnect Zoho Books</Button>}
      {confirmation && (
        <div className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p>{confirmation === "disconnect" ? "Disconnecting stops new Zoho customer matching, quotation sync and invoice creation. Existing PDFs, Zoho IDs and CRM audit history remain." : `Cancelling ${connected ? "the reconnect" : "setup"} revokes only the pending Zoho authorization${connected ? " and preserves the working connection" : ""}.`}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="destructive" disabled={pending} onClick={() => startTransition(async () => {
              try {
                if (confirmation === "disconnect") { await disconnectZoho(); toast.success("Zoho Books disconnected"); }
                else { await cancelZohoReconnect(); toast.success(connected ? "Zoho reconnect cancelled" : "Zoho setup cancelled"); }
                setConfirmation(null); router.refresh();
              } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update Zoho Books"); }
            })}>{confirmation === "disconnect" ? "Confirm disconnect" : "Confirm cancel"}</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>Keep current state</Button>
          </div>
        </div>
      )}
    </div>
  );
}
