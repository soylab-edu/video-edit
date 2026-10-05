import React from "react";
import { createRoot } from "react-dom/client";
import Access from "./Access";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Access />
  </React.StrictMode>,
);
