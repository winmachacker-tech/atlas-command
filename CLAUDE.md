# CLAUDE.md - Atlas Command Development Guidelines

## Project Overview

**Atlas Command** is a Transportation Management System (TMS) built with React + Vite frontend and Supabase backend (PostgreSQL + Edge Functions). The system manages loads, drivers, trucks, customers, and billing for freight/trucking operations.

### Key Features
- **Dipsy**: AI-powered dispatch assistant with natural language interface
- **Load Management**: Full lifecycle from available → assigned → in-transit → delivered
- **Driver Management**: HOS tracking, assignments, preferences, AI-powered matching
- **Billing**: Invoice generation, Stripe integration, customer management
- **Integrations**: Motive (ELD), Samsara (fleet tracking), Twilio (voice/SMS), Google Maps

---

## Tech Stack

### Frontend
- **React 19** with Vite 7
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Recharts** for data visualization
- **Lucide React** for icons

### Backend
- **Supabase** (PostgreSQL + Auth + Realtime + Edge Functions)
- **Supabase Edge Functions** (Deno/TypeScript) - ~80+ functions in `/supabase/functions/`
- **Row Level Security (RLS)** for multi-tenant data isolation

### External Services
- **OpenAI / Claude API** - AI features
- **Stripe** - Payment processing
- **Twilio** - Voice calls, SMS
- **Motive / Samsara** - Fleet telematics
- **Google Vision** - OCR for document processing
- **Resend** - Email delivery

---

## Project Structure

```
atlas-command/
├── src/
│   ├── components/      # React components (~80+ files)
│   │   ├── billing/     # Invoice, billing components
│   │   ├── sales/       # Sales CRM components
│   │   ├── settings/    # Settings UI
│   │   └── ui/          # Shared UI primitives
│   ├── pages/           # Page components (~60+ files)
│   ├── lib/             # Utilities and clients
│   │   ├── dipsy/       # Dipsy AI client
│   │   └── tools/       # AI tool implementations
│   ├── hooks/           # Custom React hooks
│   ├── context/         # React context providers
│   ├── services/        # External service clients
│   └── layout/          # Layout components
├── supabase/
│   ├── functions/       # Edge Functions (Deno/TypeScript)
│   │   └── _shared/     # Shared utilities (cors, admin client)
│   ├── migrations/      # SQL migrations
│   └── config.toml      # Supabase project config
├── atlas_docs/          # Internal documentation for Dipsy FAQ
├── voice-server/        # Standalone voice server (Node.js)
├── prompts/             # AI prompt templates
└── api/                 # Vercel API routes (legacy)
```

---

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Preview production build
npm run preview

# Deploy Supabase functions
supabase functions deploy <function-name>

# Deploy all functions (PowerShell)
./deploy-all-functions.ps1
```

---

## Database Schema (Key Tables)

### Core Entities
- `loads` - Freight loads with status, origin, destination, rates
- `drivers` - Driver profiles, HOS data, preferences
- `trucks` - Vehicle information, maintenance
- `customers` - Shipper/broker/receiver info
- `load_driver_assignments` - Links drivers to loads

### AI/ML Tables
- `ai_recommendations` - AI-generated driver recommendations
- `ai_predictions` - ML predictions for lanes
- `driver_feedback` - Thumbs up/down feedback for training
- `fit_scores` - Driver-lane fit scores

### Billing
- `invoices` - Customer invoices
- `invoice_line_items` - Line items on invoices

### Organization
- `organizations` - Multi-tenant org structure
- `user_profiles` - User settings and preferences
- `user_orgs` - User-organization membership

---

## Supabase Edge Functions

Edge functions are in `/supabase/functions/`. Each function has its own folder with `index.ts`.

### Naming Conventions
- `dipsy-*` - Dipsy AI assistant functions
- `sales-*` - Sales CRM functions
- `ai-*` - AI/ML functions
- `admin-*` - Admin operations
- `motive-*` / `samsara-*` - Fleet integration functions
- `stripe-*` - Payment functions

### Shared Utilities
Located in `/supabase/functions/_shared/`:
- `cors.ts` - CORS headers helper
- `admin.ts` - Supabase admin client
- `dipsyGlobalTruth.ts` - Dipsy system prompts
- `get_atlas_docs.ts` - Atlas docs retrieval

### Creating New Functions
```bash
supabase functions new <function-name>
```

Template:
```typescript
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { param } = await req.json();
    // Implementation
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

---

## Dipsy AI Assistant

Dipsy is the AI dispatch assistant. Key files:
- `src/lib/dipsyIntelligence_v2.js` - Core intelligence engine
- `src/components/DipsyAIAssistant.jsx` - Chat interface
- `src/components/DipsyStandalone.jsx` - Animated character
- `src/components/DipsyFloating.jsx` - Floating widget
- `supabase/functions/dipsy-text/` - Backend text processing
- `supabase/functions/dipsy-board-view/` - Board queries
- `docs/DIPSY_README.md` - Full Dipsy documentation

### Dipsy Architecture
1. User query → regex pattern matching (fast, deterministic)
2. If no match → OpenAI/Claude fallback
3. Execute Supabase queries directly
4. Format response with action buttons
5. Update Dipsy animation state

---

## Code Patterns

### Supabase Queries (Frontend)
```javascript
import { supabase } from '@/lib/supabase';

// Select with joins
const { data, error } = await supabase
  .from('loads')
  .select(`
    *,
    load_driver_assignments (
      driver:drivers (id, full_name, phone)
    )
  `)
  .eq('status', 'AVAILABLE')
  .limit(10);
```

### React Component Pattern
```jsx
export default function MyComponent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data, error } = await supabase.from('table').select('*');
    if (!error) setData(data);
    setLoading(false);
  }

  if (loading) return <LoadingScreen />;
  return <div>{/* UI */}</div>;
}
```

### Edge Function with Auth
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader! } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  // Continue with authenticated user
});
```

---

## Load Statuses

The canonical load status flow:
1. `AVAILABLE` - New load, no driver assigned
2. `ASSIGNED` - Driver assigned, not yet picked up
3. `IN_TRANSIT` - Load picked up, en route
4. `DELIVERED` - Load delivered, awaiting POD
5. `COMPLETED` - POD received, ready for billing
6. `INVOICED` - Invoice generated
7. `PAID` - Payment received

Problem statuses:
- `PROBLEM` - Issue with load
- `CANCELLED` - Load cancelled

---

## Environment Variables

### Frontend (.env.local)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_OPENAI_API_KEY=xxx
VITE_GOOGLE_MAPS_API_KEY=xxx
```

### Supabase Secrets
```
OPENAI_API_KEY
ANTHROPIC_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
MOTIVE_API_KEY
SAMSARA_API_KEY
RESEND_API_KEY
GOOGLE_VISION_CREDENTIALS
```

---

## Important Conventions

### File Naming
- React components: `PascalCase.jsx`
- Utilities/hooks: `camelCase.js`
- Edge functions: `kebab-case/index.ts`
- Migrations: `YYYYMMDD_description.sql`

### Code Style
- Use functional components with hooks
- Prefer `async/await` over `.then()`
- Always handle Supabase errors: `if (error) { ... }`
- Use Tailwind for styling (no CSS modules)
- Use Lucide icons consistently

### Security
- Never expose service role keys to frontend
- Always use RLS for data isolation
- Validate user input in Edge Functions
- Use parameterized queries (Supabase SDK handles this)

### Multi-tenancy
- All queries are filtered by `org_id` via RLS
- User's org is determined from `user_orgs` table
- Use `useActiveOrg()` hook for current org context

---

## Testing Locally

### Supabase Functions
```bash
supabase functions serve <function-name> --env-file supabase/.env
```

### Test with curl
```bash
curl -X POST http://localhost:54321/functions/v1/<function-name> \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

---

## Deployment

### Frontend (Vercel)
- Automatic deploys from `main` branch
- Preview deploys for PRs

### Supabase Functions
```bash
# Deploy single function
supabase functions deploy <function-name>

# Deploy all functions
./deploy-all-functions.ps1
```

### Database Migrations
```bash
# Create new migration
supabase migration new <description>

# Push to production
supabase db push
```

---

## Common Tasks

### Add a new page
1. Create component in `src/pages/NewPage.jsx`
2. Add route in `src/pages/router.jsx`
3. Add sidebar link in `src/components/Sidebar.jsx`

### Add a new Edge Function
1. `supabase functions new my-function`
2. Implement in `supabase/functions/my-function/index.ts`
3. Deploy: `supabase functions deploy my-function`
4. Call from frontend using `supabase.functions.invoke('my-function', { body: {...} })`

### Add Dipsy capability
1. Add regex pattern in `src/lib/dipsyIntelligence_v2.js`
2. Create handler function
3. Return structured response with `{ success, message, formatted, actions }`

---

## Troubleshooting

### "Permission denied" errors
- Check RLS policies in Supabase dashboard
- Verify user has correct org membership
- Check auth token is being passed

### Edge Function not responding
- Check function logs: `supabase functions logs <name>`
- Verify secrets are set: `supabase secrets list`
- Test locally first with `supabase functions serve`

### Dipsy not understanding queries
- Check regex patterns in `dipsyIntelligence_v2.js`
- Enable DEBUG mode for verbose logging
- Check browser console for errors

---

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Vite](https://vitejs.dev)
- Internal: `docs/DIPSY_README.md` - Full Dipsy documentation
- Internal: `atlas_docs/` - Domain knowledge for Dipsy FAQ
