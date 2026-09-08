import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BookingApp from "./App";
import CabinetApp from "./CabinetApp";
import "./styles.css";

function RoutedApp() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/cabinet" || path === "/cabinet.html") return <CabinetApp />;
  return <BookingApp />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RoutedApp />
  </StrictMode>,
);
