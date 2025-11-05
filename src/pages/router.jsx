import { createBrowserRouter, redirect } from "react-router-dom";
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

// Lazy-loaded pages
const Dashboard = () => import("./pages/Dashboard.jsx").then(m => ({ default: m.default }));
const Loads = () => import("./pages/Loads.jsx").then(m => ({ default: m.default }));
const InTransit = () => import("./pages/InTransit.jsx").then(m => ({ default: m.default }));
const Delivered = () => import("./pages/Delivered.jsx").then(m => ({ default: m.default }));
const Activity = () => import("./pages/Activity.jsx").then(m => ({ default: m.default }));
const Settings = () => import("./pages/Settings.jsx").then(m => ({ default: m.default }));
const NotFound = () => import("./pages/NotFound.jsx").then(m => ({ default: m.default }));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, loader: () => redirect("/dashboard") },
      { path: "dashboard", element: <Dashboard /> },
      { path: "loads", element: <Loads /> },
      { path: "in-transit", element: <InTransit /> },
      { path: "delivered", element: <Delivered /> },
      { path: "activity", element: <Activity /> },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
