import "@thumbcade/design-tokens/tokens.css";
import "./styles/app.css";
import "./styles/phone.css";
import "./styles/panels.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
