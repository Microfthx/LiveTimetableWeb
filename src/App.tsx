import { useEffect } from "react";
import { ActivityListPage } from "./pages/ActivityListPage";
import { AdminPage } from "./pages/AdminPage";
import { EventDetailPage } from "./pages/EventDetailPage";

export default function App() {
  useEffect(() => {
    // Remove the first server version's long-lived raw key from this browser.
    try { localStorage.removeItem("live-idol-admin-key"); } catch { /* Storage may be unavailable. */ }
  }, []);
  const path = window.location.pathname;
  if (path === "/" || path === "") return <ActivityListPage />;
  if (path === "/admin") return <AdminPage />;
  const detail = /^\/events\/([^/]+)\/?$/.exec(path);
  if (detail) return <EventDetailPage id={detail[1]} />;
  return <div className="sync-screen"><h1>页面不存在</h1><a className="primary-button" href="/">返回活动列表</a></div>;
}
