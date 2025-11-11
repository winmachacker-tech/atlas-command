import React from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import MainLayout from "./layout/MainLayout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

/**
 * We use the route-level `lazy` API (React Router v6.4+).
 * Each lazy() module must default-export a React component.
 * Example in a page file:
 *   export default function Dashboard() { ... }
 */

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      // "/" -> "/dashboard"
      {
        index: true,
        loader: () => redirect("/dashboard"),
      },

      // Dashboard
      {
        path: "dashboard",
        lazy: () => import("./pages/Dashboard.jsx"),
      },

      // Loads
      {
        path: "loads",
        lazy: () => import("./pages/Loads.jsx"),
      },

      // In Transit
      {
        path: "in-transit",
        lazy: () => import("./pages/InTransit.jsx"),
      },

      // Delivered
      {
        path: "delivered",
        lazy: () => import("./pages/Delivered.jsx"),
      },

      // Activity
      {
        path: "activity",
        lazy: () => import("./pages/Activity.jsx"),
      },

      // Settings
      {
        path: "settings",
        lazy: () => import("./pages/Settings.jsx"),
      },

      // ✅ NEW: AI Lab Proof
      {
        path: "ai-lab-proof",
        lazy: () => import("./pages/AILabProof.jsx"),
      },

      // 404 inside layout
      {
        path: "*",
        lazy: () => import("./pages/NotFound.jsx"),
      },
    ],
  },
]);
