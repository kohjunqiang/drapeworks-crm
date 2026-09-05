"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { moveOrderRoom } from "@/lib/actions/orders";

type Props = {
  orderId: string;
  roomId: string;
  roomLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

export function RoomOrderControls({
  orderId,
  roomId,
  roomLabel,
  canMoveUp,
  canMoveDown,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function move(direction: "up" | "down") {
    startTransition(async () => {
      try {
        await moveOrderRoom({ orderId, roomId, direction });
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not reorder room",
        );
      }
    });
  }

  if (!canMoveUp && !canMoveDown) return null;

  return (
    <div className="flex shrink-0 items-center gap-1" aria-label={`Reorder ${roomLabel}`}>
      <span className="mr-0.5 text-[10px] font-normal uppercase tracking-wide text-slate-400">
        Order
      </span>
      <button
        type="button"
        onClick={() => move("up")}
        disabled={pending || !canMoveUp}
        aria-label={`Move ${roomLabel} up`}
        title={`Move ${roomLabel} up`}
        className="h-7 w-7 rounded border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => move("down")}
        disabled={pending || !canMoveDown}
        aria-label={`Move ${roomLabel} down`}
        title={`Move ${roomLabel} down`}
        className="h-7 w-7 rounded border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
      >
        ↓
      </button>
    </div>
  );
}
