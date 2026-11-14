"use client";
import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

/** Subscribes to staff real-time events (NFR-02) and calls `onEvent` for each. */
export function useStaffSocket(events: string[], onEvent: (event: string, payload: unknown) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const socket = io("/staff", { path: "/socket.io", withCredentials: true, transports: ["polling", "websocket"] });
    for (const e of events) socket.on(e, (p: unknown) => cb.current(e, p));
    return () => void socket.disconnect();
  }, [events.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}
