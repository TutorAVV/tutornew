import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BookingApp from "./App";
import CabinetApp from "./CabinetApp";
import AdminApp from "./AdminApp";
import TelegramApp from "./TelegramApp";
import TestApp from "./TestApp";
import "./styles.css";

function RoutedApp() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/cabinet" || path === "/cabinet.html") return <CabinetApp />;
  if (path === "/admin" || path === "/admin.html") return <AdminApp />;
  if (path === "/telegram" || path === "/telegram.html") return <TelegramApp />;
  if (path === "/test" || path === "/test.html") return <TestApp />;
  return <BookingApp />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RoutedApp />
  </StrictMode>,
);
