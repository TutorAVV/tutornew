import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BookingApp from "./App";
import CabinetApp from "./CabinetApp";
import AdminApp from "./AdminApp";
import "./styles.css";

function RoutedApp() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/cabinet" || path === "/cabinet.html") return <CabinetApp />;
  if (path === "/admin" || path === "/admin.html") return <AdminApp />;
  return <BookingApp />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RoutedApp />
  </StrictMode>,
);
