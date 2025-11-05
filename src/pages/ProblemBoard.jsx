// src/pages/ProblemBoard.jsx
// Shim that forwards the old "ProblemBoard" route to the new Issues page.
// This way, any links or routes still pointing to ProblemBoard will
// render the full Issues experience without touching your router.

import Issues from "./Issues.jsx";

export default function ProblemBoardPage() {
  return <Issues />;
}

// (Optional) Named export if anything imports { ProblemBoardPage }
export { ProblemBoardPage };
