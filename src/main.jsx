// src/main.jsx
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { pingSupabase } from "./lib/pingSupabase";
import MainLayout from "./components/MainLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import Protected from "./components/Protected";
import "./index.css";

// Log env sanity
pingSupabase();

/** Route-level code splitting */
const Dashboard  = lazy(() => import("./pages/Dashboard"));
const Loads      = lazy(() => import("./pages/Loads"));
const InTransit  = lazy(() => import("./pages/InTransit"));
const Trucks     = lazy(() => import("./pages/Trucks"));
const Drivers    = lazy(() => import("./pages/Drivers"));
const AdminAudit = lazy(() => import("./pages/AdminAudit"));
const Login      = lazy(() => import("./pages/Login"));

/** Simple fallback */
const Fallback = () => <div className="p-6">Loading…</div>;

const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <Suspense fallback={<Fallback />}>
        <Login />
      </Suspense>
    ),
  },
  {
    path: "/",
    element: (
      <Protected>
        <MainLayout />
      </Protected>
    ),
    errorElement: <div className="p-6">Route not found.</div>,
    children: [
      {
        index: true,
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <Dashboard />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "loads",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <Loads />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "in-transit",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <InTransit />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "trucks",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <Trucks />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "drivers",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <Drivers />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "admin/audit",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<Fallback />}>
              <AdminAudit />
            </Suspense>
          </ErrorBoundary>
        ),
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
