import { AppState } from "react-native";
import { postEvents } from "./api";
import { EventQueue } from "./eventQueue";
import { kv } from "./kv";

const KEY = "tc.events.pending";

export const events = new EventQueue({
  send: (batch) => postEvents(batch),
  load: () => kv.getJSON(KEY, []),
  save: (pending) => kv.setJSON(KEY, pending),
});

let timer: ReturnType<typeof setInterval> | null = null;

export function startEventPump(): void {
  if (timer) return;
  timer = setInterval(() => void events.flush(), 5000);
  AppState.addEventListener("change", (s) => {
    if (s !== "active") {
      events.persist();
      void events.flush();
    }
  });
}

export const track = events.track.bind(events);
