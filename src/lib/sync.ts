import { useEffect, useState } from "react";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { toast } from "sonner";

// Pending water-reading queue kept in localStorage so meter readers can
// keep working in low-connectivity zones. When the browser comes back
// online we flush the queue to the local store AND broadcast to any
// other online sessions of the same tenant via Supabase Realtime.
export interface PendingReading {
  clientId: string;
  meterId: number;
  current: number;
  imageData?: string;
  createdAt: string;
  by?: string;
  latitude: number;
  longitude: number;
  tenantId?: string;
}

// v2: payload is keyed on real meter records (post meter-architecture migration).
// Pre-migration queues used synthesized meter ids and are intentionally dropped.
const KEY = "mizan-pending-readings-v2";

function load(): PendingReading[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingReading[]) : [];
  } catch {
    return [];
  }
}

function save(arr: PendingReading[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(arr));
  window.dispatchEvent(new Event("mizan-pending-updated"));
}

export function getPending(): PendingReading[] {
  return load();
}

export function addPending(
  p: Omit<PendingReading, "clientId" | "createdAt"> & { clientId?: string },
): PendingReading {
  const list = load();
  const item: PendingReading = {
    ...p,
    clientId: p.clientId ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  save([...list, item]);
  return item;
}

export function removePending(clientId: string) {
  save(load().filter((p) => p.clientId !== clientId));
}

export function syncPending(): { synced: number } {
  const list = load();
  if (!list.length) return { synced: 0 };

  const store = useStore.getState();
  let n = 0;
  const remaining: PendingReading[] = [];

  for (const p of list) {
    try {
      store.addReadingWithBill({
        meterId: p.meterId,
        current: p.current,
        photo: p.imageData,
        by: p.by,
        lat: p.latitude,
        lng: p.longitude,
      });
      // Fire-and-forget realtime broadcast so the Manager dashboard and
      // Collector bills view update instantly on all connected devices.
      if (p.tenantId) {
        void broadcastTenantEvent(p.tenantId, "reading", {
          meterId: p.meterId,
          current: p.current,
          by: p.by,
          at: new Date().toISOString(),
        });
      }
      n++;
    } catch (error) {
      toast.error(`تعذّرت مزامنة قراءة مؤجلة: ${(error as Error).message}`);
      remaining.push(p);
    }
  }

  save(remaining);
  return { synced: n };
}

// ─── Supabase Realtime broadcast ────────────────────────────────────────────
// Cheap tenant-scoped broadcasts (no DB write per message). Managers and
// collectors listening to `tenant:<id>` receive updates instantly.
export type TenantEventType = "reading" | "bill" | "payment";

export async function broadcastTenantEvent(
  tenantId: string,
  type: TenantEventType,
  payload: Record<string, unknown>,
) {
  try {
    const channel = supabase.channel(`tenant:${tenantId}`);
    await channel.subscribe();
    await channel.send({ type: "broadcast", event: type, payload });
    await supabase.removeChannel(channel);
  } catch (err) {
    console.warn("[Mizan] broadcast failed:", err);
  }
}

export function subscribeToTenantEvents(
  tenantId: string,
  onEvent: (type: TenantEventType, payload: Record<string, unknown>) => void,
) {
  const channel = supabase.channel(`tenant:${tenantId}`);
  (["reading", "bill", "payment"] as const).forEach((event) => {
    channel.on("broadcast", { event }, (msg) =>
      onEvent(event, (msg.payload ?? {}) as Record<string, unknown>),
    );
  });
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => {
      setOnline(true);
      setTimeout(() => {
        const result = syncPending();
        if (result.synced > 0) {
          console.log(`[Mizan] synced ${result.synced} pending readings.`);
        }
      }, 1000);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

export function usePendingCount() {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    const refresh = () => setCount(load().length);
    refresh();
    window.addEventListener("mizan-pending-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("mizan-pending-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return count;
}
