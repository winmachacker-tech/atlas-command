# Dipsy - Intelligent AI Dispatch Assistant

## Table of Contents
1. [Overview](#overview)
2. [The Technology Behind Dipsy](#the-technology-behind-dipsy)
3. [Architecture & System Design](#architecture--system-design)
4. [How It Works](#how-it-works)
5. [Capabilities & Features](#capabilities--features)
6. [Natural Language Processing](#natural-language-processing)
7. [Database Integration](#database-integration)
8. [UI/UX Components](#uiux-components)
9. [Security & Data Protection](#security--data-protection)
10. [Extension & Customization](#extension--customization)
11. [API Reference](#api-reference)
12. [Troubleshooting](#troubleshooting)

---

## Overview

Dipsy is an intelligent AI-powered dispatch assistant integrated into Atlas Command TMS (Transportation Management System). Unlike traditional chatbots that only answer questions, Dipsy can **directly interact with your database**, execute operations, and provide actionable insights - all through natural language conversation.

### Key Differentiators
- **Database-First Intelligence**: Directly queries Supabase without API intermediaries
- **Action-Oriented**: Not just answers - Dipsy can assign drivers, update statuses, and trigger operations
- **Hybrid AI**: Combines regex-based intent recognition with LLM fallback for maximum reliability
- **Visual Feedback**: Animated character provides intuitive status indicators
- **Context-Aware**: Maintains conversation history and understands follow-up questions

---

## The Technology Behind Dipsy

### Technology Stack

#### Frontend
- **React 18** - Component-based UI with hooks
- **React Router** - Client-side routing and navigation
- **Tailwind CSS** - Utility-first styling
- **Lucide Icons** - Consistent iconography
- **Framer Motion** (via CSS) - Character animations

#### Backend & Data
- **Supabase** - PostgreSQL database with real-time subscriptions
- **Supabase Auth** - User authentication and RLS (Row Level Security)
- **Supabase Realtime** - Live data updates
- **Edge Functions** - Serverless API endpoints

#### AI & Intelligence
- **Custom NLP Engine** - Regex-based intent recognition
- **OpenAI GPT-4** - Fallback for complex queries
- **Claude API** - Alternative LLM endpoint (configurable)

### Core Components

```
/src
├── lib/
│   └── dipsyIntelligence.js       # Core intelligence engine
├── components/
│   ├── DipsyStandalone.jsx        # Animated character
│   ├── DipsyFloating.jsx          # Draggable widget
│   ├── DipsyAIAssistant.jsx       # Chat interface
│   └── AIQuickLauncher.jsx        # Modal launcher
└── layout/
    └── MainLayout.jsx              # App-wide integration
```

---

## Architecture & System Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         User Input                           │
│              "Show me load AC-12345"                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  DipsyAIAssistant.jsx                        │
│           (Chat Interface & State Management)                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                 dipsyIntelligence.js                         │
│              (Intent Recognition Engine)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Parse natural language input                     │  │
│  │  2. Match against regex patterns                     │  │
│  │  3. Extract parameters (load ID, driver name, etc)   │  │
│  │  4. Route to appropriate function                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────┐
│   Database   │    │   OpenAI     │
│   Queries    │    │   Fallback   │
│              │    │              │
│  Supabase    │    │  Complex     │
│  PostgreSQL  │    │  Questions   │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Response Formatter                        │
│                                                              │
│  • Format data for display                                  │
│  • Generate action buttons                                  │
│  • Create navigation links                                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      UI Rendering                            │
│                                                              │
│  • Display formatted message                                │
│  • Render action buttons                                    │
│  • Update Dipsy animation state                             │
│  • Enable user interactions                                 │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram

```
User Query
    │
    ├─→ processDipsyQuery()
    │       │
    │       ├─→ Regex Pattern Matching
    │       │       │
    │       │       ├─→ MATCH FOUND
    │       │       │       │
    │       │       │       ├─→ getLoadDetails()
    │       │       │       ├─→ getActiveDrivers()
    │       │       │       ├─→ assignDriverToLoad()
    │       │       │       └─→ updateLoadStatus()
    │       │       │               │
    │       │       │               └─→ Supabase Query
    │       │       │                       │
    │       │       │                       └─→ Format Response
    │       │       │
    │       │       └─→ NO MATCH
    │       │               │
    │       │               └─→ needsAI: true
    │       │                       │
    │       │                       └─→ handleOpenAIQuery()
    │       │                               │
    │       │                               └─→ OpenAI API
    │       │
    │       └─→ Return Structured Response
    │               │
    │               └─→ { success, message, data, formatted, actions }
    │
    └─→ DipsyAIAssistant Renders
            │
            ├─→ Display Message
            ├─→ Render Action Buttons
            ├─→ Update Dipsy Animation
            └─→ Enable Copy/Navigate
```

### State Management

Dipsy uses React Context API for global state management:

```javascript
DipsyContext
├── state: string              // Current animation state
├── setState: function         // Direct state setter
└── Helper methods:
    ├── setThinking()         // Processing query
    ├── setConfident()        // Successful result
    ├── setLightbulb()        // Insight moment
    ├── setCelebrating()      // User celebration
    ├── setLearning()         // Processing feedback
    ├── setIdle()            // Resting state
    └── setSleeping()        // Inactive state
```

---

## How It Works

### 1. User Input Processing

When a user types a query, the system follows this flow:

```javascript
// User types: "Show me load AC-12345"

// 1. Input captured
const userMessage = input.trim();

// 2. Add to conversation history
addMessage('user', userMessage);

// 3. Update Dipsy state
dipsy.setThinking();

// 4. Process query
const result = await processDipsyQuery(userMessage, userId);
```

### 2. Intent Recognition

The intelligence engine uses regex patterns to identify user intent:

```javascript
// Pattern matching in processDipsyQuery()
if (msg.match(/show (me )?load (.*)/i)) {
  // Extract load reference
  const match = msg.match(/show (me )?load (.*)/i);
  const loadRef = match[2].trim();
  
  // Execute appropriate function
  return await getLoadDetails(loadRef);
}
```

#### Supported Patterns

**Load Patterns:**
- `/show (me )?load (.*)/i` → Show specific load
- `/show (me )?(available|open) loads/i` → Available loads
- `/show (me )?(in.transit|in transit) loads/i` → In-transit loads
- `/loads? (going |headed )?to (.*)/i` → Loads by destination
- `/loads? from (.*)/i` → Loads by origin

**Driver Patterns:**
- `/show (me )?driver (.*)/i` → Specific driver
- `/show (me )?(active|available) drivers/i` → Active drivers
- `/who.s (assigned to|on) load (.*)/i` → Driver for load

**Action Patterns:**
- `/assign (driver )?(.+?) to load (.+)/i` → Assign driver
- `/unassign (driver )?(from )?load (.+)/i` → Unassign driver
- `/mark load (.+?) (as )?delivered/i` → Update status

**Analytics Patterns:**
- `/how many (.*) loads/i` → Count by status
- `/(what|show).*(today|deliver.*today)/i` → Today's deliveries
- `/calculate|rpm|revenue/i` → Calculations

### 3. Database Query Execution

Once intent is identified, Dipsy executes Supabase queries:

```javascript
async function getLoadDetails(loadRef) {
  // Query database with joins
  const { data, error } = await supabase
    .from('loads')
    .select(`
      *,
      load_driver_assignments (
        driver:drivers (
          id,
          full_name,
          phone,
          status
        )
      )
    `)
    .or(`reference.ilike.%${loadRef}%,id.eq.${loadRef}`)
    .single();

  if (error || !data) {
    return {
      success: false,
      message: `I couldn't find load "${loadRef}".`
    };
  }

  // Format and return structured response
  return {
    success: true,
    data: data,
    message: `Found load ${data.reference}!`,
    formatted: formatLoadDetails(data),
    actions: [
      { label: 'View Full Details', action: 'navigate', path: `/loads/${data.id}` }
    ]
  };
}
```

### 4. Response Formatting

Data is formatted for optimal user experience:

```javascript
function formatLoadDetails(load, driver) {
  return `
**Load ${load.reference}**
Status: ${load.status}
Shipper: ${load.shipper}
Customer: ${load.customer}

📍 ${load.origin} → ${load.destination}
Pickup: ${load.pickup_date}
Delivery: ${load.delivery_date}

💰 Rate: $${load.rate}
Miles: ${load.miles}
RPM: $${(load.rate / load.miles).toFixed(2)}

${driver ? `👤 Driver: ${driver.full_name}\n📞 ${driver.phone}` : '⚠️ No driver assigned'}
  `.trim();
}
```

### 5. UI Rendering

The response is displayed with interactive elements:

```javascript
// Message display
<div className="bg-zinc-800/50 rounded-xl p-3">
  <div className="whitespace-pre-wrap">{message.content}</div>
  
  {/* Action buttons */}
  {message.actions && (
    <div className="mt-3 flex gap-2">
      {message.actions.map(action => (
        <button onClick={() => handleAction(action)}>
          {action.label}
        </button>
      ))}
    </div>
  )}
</div>
```

### 6. Animation State Updates

Dipsy's visual state reflects processing status:

```javascript
// Processing states
dipsy.setThinking()      // User sends query
dipsy.setLightbulb()     // Successful database query
dipsy.setConfident()     // High-confidence result
dipsy.setCelebrating()   // User action completed
dipsy.setLearning()      // Processing feedback
dipsy.setIdle()         // Return to rest
dipsy.setSleeping()      // Extended inactivity
```

---

## Capabilities & Features

### Database Operations

#### Read Operations

**Loads:**
```javascript
✓ Show specific load by reference/ID
✓ List available loads
✓ List in-transit loads  
✓ List problem/at-risk loads
✓ Filter loads by destination
✓ Filter loads by origin
✓ Filter loads by date range
✓ Count loads by status
✓ Show today's deliveries
✓ Show weekly summary
```

**Drivers:**
```javascript
✓ Show specific driver details
✓ List active drivers
✓ List assigned drivers
✓ Check driver for specific load
✓ Show driver history
✓ Show driver performance
```

**Customers:**
```javascript
✓ Show customer details
✓ List customer loads
✓ Show customer statistics
```

**Analytics:**
```javascript
✓ Load count by status
✓ Revenue calculations
✓ RPM (Rate Per Mile) calculations
✓ Weekly/monthly summaries
✓ Driver utilization rates
✓ On-time delivery metrics
```

#### Write Operations

**Assignments:**
```javascript
✓ Assign driver to load
✓ Unassign driver from load
✓ Validate driver availability
✓ Update driver status
✓ Create assignment records
✓ Log assignment history
```

**Status Updates:**
```javascript
✓ Mark load as delivered
✓ Mark load as in-transit
✓ Mark load as problem
✓ Update load timestamps
✓ Create audit trail
```

**Data Modifications:**
```javascript
✓ Update load details
✓ Update driver information
✓ Create notifications
✓ Log user actions
```

### Natural Language Understanding

#### Flexible Query Formats

Dipsy understands multiple ways to ask the same question:

**Example: Showing a Load**
```
"Show me load AC-12345"
"Display load AC-12345"
"Load AC-12345"
"What's the status of load AC-12345?"
"Tell me about load AC-12345"
"Load details for AC-12345"
```

**Example: Finding Drivers**
```
"Show me active drivers"
"List active drivers"
"What drivers are available?"
"Who's available?"
"Active drivers"
"Available drivers"
```

**Example: Assignments**
```
"Assign driver John to load AC-12345"
"Put John on load AC-12345"
"Assign John to AC-12345"
"Add driver John to load AC-12345"
```

#### Fuzzy Matching

Dipsy uses fuzzy string matching for names and references:

```javascript
// User input variations all work:
"Show me driver Barack"
"Show me driver barack obama"
"Show me driver Barack Obama"
"Show driver obama"

// All match: driver.full_name = "Barack Obama"
```

#### Context Awareness

Dipsy maintains conversation context:

```
User: "Show me load AC-12345"
Dipsy: [shows load details]

User: "Who's assigned to that load?"
Dipsy: [uses context - knows "that load" = AC-12345]

User: "Unassign them"
Dipsy: [knows "them" = the driver from previous response]
```

### Action System

#### Action Types

**Navigate Actions:**
```javascript
{
  label: 'View Full Details',
  action: 'navigate',
  path: '/loads/abc-123-xyz'
}
// Clicking navigates to the specified route
```

**Assign Actions:**
```javascript
{
  label: 'Assign Driver',
  action: 'assign',
  loadId: 'abc-123-xyz'
}
// Clicking opens assignment modal
```

**Copy Actions:**
```javascript
{
  label: 'Copy Load Info',
  action: 'copy',
  content: 'Load details...'
}
// Clicking copies to clipboard
```

#### Action Button Rendering

```javascript
// Actions appear as clickable buttons below responses
{message.actions && (
  <div className="mt-3 flex gap-2">
    {message.actions.map((action, i) => (
      <button
        key={i}
        onClick={() => handleAction(action)}
        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg"
      >
        {action.label}
        <ExternalLink className="h-3 w-3" />
      </button>
    ))}
  </div>
)}
```

### AI Fallback System

When Dipsy doesn't understand a query, it falls back to OpenAI:

```javascript
// In processDipsyQuery()
return {
  success: false,
  needsAI: true,
  message: "I'll need to think about that one..."
};

// In DipsyAIAssistant.jsx
if (result.needsAI) {
  await handleOpenAIQuery(userMessage);
}
```

#### OpenAI Integration

```javascript
async function handleOpenAIQuery(userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are Dipsy, an AI assistant for Atlas Command TMS..."
        },
        {
          role: "user",
          content: userMessage
        }
      ]
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

#### Hybrid Intelligence

```
┌─────────────────────────────────────┐
│         User Query                  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│    Pattern Matching (Regex)         │
│    • Fast (< 1ms)                   │
│    • Deterministic                  │
│    • Database operations            │
└─────────────┬───────────────────────┘
              │
        Match Found?
              │
       ┌──────┴──────┐
       │             │
      YES            NO
       │             │
       ▼             ▼
┌──────────┐  ┌──────────────┐
│ Execute  │  │   OpenAI     │
│ Database │  │   Fallback   │
│  Query   │  │ • Flexible   │
│          │  │ • Creative   │
└──────────┘  │ • Slower     │
              └──────────────┘
```

---

## Natural Language Processing

### Intent Recognition Engine

Dipsy's NLP engine uses a hierarchical pattern matching system:

#### Layer 1: Direct Commands
Exact matches for common operations:
```javascript
const directCommands = {
  'available loads': () => getAvailableLoads(),
  'active drivers': () => getActiveDrivers(),
  'in transit': () => getInTransitLoads(),
  'problem loads': () => getProblemLoads()
};
```

#### Layer 2: Regex Patterns
Flexible pattern matching with parameter extraction:
```javascript
// Pattern: /show (me )?load (.*)/i
// Matches:
"show me load AC-12345"  → loadRef = "AC-12345"
"show load AC-12345"     → loadRef = "AC-12345"
"Show Load AC-12345"     → loadRef = "AC-12345"
"SHOW ME LOAD AC-12345"  → loadRef = "AC-12345"
```

#### Layer 3: Semantic Similarity
For complex queries, falls back to LLM understanding:
```javascript
// User: "Which driver should I pick for this Phoenix run?"
// Too complex for regex → OpenAI processes
```

### Parameter Extraction

Dipsy extracts structured data from natural language:

```javascript
// Input: "Assign driver John Smith to load AC-12345"

const match = msg.match(/assign (driver )?(.+?) to load (.+)/i);
// match[2] = "John Smith"  (driver name)
// match[3] = "AC-12345"    (load reference)

// Use extracted parameters
await assignDriverToLoad("John Smith", "AC-12345", userId);
```

### Query Normalization

All inputs are normalized before processing:

```javascript
function normalizeQuery(input) {
  return input
    .toLowerCase()           // Case-insensitive
    .trim()                 // Remove whitespace
    .replace(/\s+/g, ' ')   // Collapse multiple spaces
    .replace(/[?!.]+$/g, ''); // Remove trailing punctuation
}

// "  SHOW   ME  LOAD  AC-12345?!  "
// becomes
// "show me load ac-12345"
```

### Ambiguity Resolution

When queries are ambiguous, Dipsy asks for clarification:

```javascript
// User: "Show me the load"
// Response: "Which load? Please provide a load reference number."

// User: "Assign John"
// Response: "Assign John to which load? Please provide a load reference."
```

---

## Database Integration

### Supabase Architecture

Dipsy integrates directly with Supabase PostgreSQL:

```
┌──────────────────────────────────────────────┐
│              Supabase Cloud                   │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │         PostgreSQL Database            │ │
│  │                                        │ │
│  │  Tables:                               │ │
│  │  ├── loads                             │ │
│  │  ├── drivers                           │ │
│  │  ├── trucks                            │ │
│  │  ├── customers                         │ │
│  │  ├── load_driver_assignments          │ │
│  │  └── ai_recommendations               │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │      Row Level Security (RLS)          │ │
│  │  • User authentication                 │ │
│  │  • Organization isolation              │ │
│  │  • Role-based access                   │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │         Realtime Subscriptions         │ │
│  │  • Live data updates                   │ │
│  │  • WebSocket connections               │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                    │
                    │ Supabase Client SDK
                    ▼
┌──────────────────────────────────────────────┐
│         dipsyIntelligence.js                 │
│                                              │
│  import { supabase } from './supabase'      │
│                                              │
│  const { data } = await supabase            │
│    .from('loads')                           │
│    .select('*')                             │
│    .eq('status', 'AVAILABLE')               │
└──────────────────────────────────────────────┘
```

### Query Patterns

#### Simple Select
```javascript
const { data, error } = await supabase
  .from('loads')
  .select('id, reference, status')
  .eq('status', 'AVAILABLE')
  .limit(10);
```

#### Join Queries
```javascript
const { data, error } = await supabase
  .from('loads')
  .select(`
    *,
    load_driver_assignments (
      driver:drivers (
        full_name,
        phone,
        status
      )
    )
  `)
  .eq('id', loadId)
  .single();
```

#### Fuzzy Search
```javascript
const { data, error } = await supabase
  .from('drivers')
  .select('*')
  .ilike('full_name', `%${searchTerm}%`)
  .limit(10);
```

#### OR Conditions
```javascript
const { data, error } = await supabase
  .from('loads')
  .select('*')
  .or(`reference.ilike.%${loadRef}%,id.eq.${loadRef}`)
  .single();
```

#### Insert with Return
```javascript
const { data, error } = await supabase
  .from('load_driver_assignments')
  .insert({
    load_id: loadId,
    driver_id: driverId,
    assigned_at: new Date().toISOString()
  })
  .select()
  .single();
```

#### Update Operations
```javascript
const { data, error } = await supabase
  .from('loads')
  .update({ 
    status: 'DELIVERED',
    delivered_at: new Date().toISOString()
  })
  .eq('id', loadId)
  .select()
  .single();
```

#### Aggregations
```javascript
const { count, error } = await supabase
  .from('loads')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'AVAILABLE');
```

### Transaction Handling

Complex operations use multiple queries:

```javascript
async function assignDriverToLoad(driverName, loadRef, userId) {
  // 1. Find driver
  const { data: driver } = await supabase
    .from('drivers')
    .select('id, full_name, status')
    .ilike('full_name', `%${driverName}%`)
    .single();

  // 2. Find load
  const { data: load } = await supabase
    .from('loads')
    .select('id, reference, status')
    .or(`reference.ilike.%${loadRef}%,id.eq.${loadRef}`)
    .single();

  // 3. Create assignment
  await supabase
    .from('load_driver_assignments')
    .insert({
      load_id: load.id,
      driver_id: driver.id,
      assigned_at: new Date().toISOString()
    });

  // 4. Update driver status
  await supabase
    .from('drivers')
    .update({ status: 'ASSIGNED' })
    .eq('id', driver.id);

  // 5. Update load status if needed
  if (load.status === 'AVAILABLE') {
    await supabase
      .from('loads')
      .update({ status: 'IN_TRANSIT' })
      .eq('id', load.id);
  }

  return {
    success: true,
    message: `Assigned ${driver.full_name} to load ${load.reference}!`
  };
}
```

### Error Handling

Robust error handling for database operations:

```javascript
async function getLoadDetails(loadRef) {
  try {
    const { data, error } = await supabase
      .from('loads')
      .select('*')
      .or(`reference.ilike.%${loadRef}%,id.eq.${loadRef}`)
      .single();

    // Supabase error
    if (error) {
      console.error('Supabase error:', error);
      return {
        success: false,
        message: `Database error: ${error.message}`
      };
    }

    // No data found
    if (!data) {
      return {
        success: false,
        message: `I couldn't find load "${loadRef}". Check the reference?`
      };
    }

    // Success
    return {
      success: true,
      data: data,
      message: `Found load ${data.reference}!`
    };

  } catch (err) {
    // Unexpected error
    console.error('Unexpected error:', err);
    return {
      success: false,
      message: `Something went wrong: ${err.message}`
    };
  }
}
```

---

## UI/UX Components

### Character Animation System

Dipsy's visual states provide intuitive feedback:

#### Animation States

**Idle State:**
```javascript
{
  eyeScale: 'scale-100',
  pulseSpeed: 'animate-pulse-slow',  // 3s cycle
  borderColor: 'border-cyan-400',
  bgGlow: 'shadow-[0_0_20px_rgba(6,182,212,0.3)]'
}
```

**Thinking State:**
```javascript
{
  eyeScale: 'scale-100',
  pupilPosition: 'animate-pupil-dart',  // Eyes scanning
  pulseSpeed: 'animate-pulse-fast',     // 0.8s cycle
  borderColor: 'border-cyan-400',
  bgGlow: 'shadow-[0_0_30px_rgba(6,182,212,0.6)]'
}
```

**Lightbulb State:**
```javascript
{
  eyeScale: 'scale-125 animate-eyes-wide-pop',
  pupilPosition: 'top-0 left-1/2',  // Looking up
  borderColor: 'border-green-400',
  bgGlow: 'shadow-[0_0_40px_rgba(34,197,94,0.8)]',
  extraElement: <Lightbulb with glow and rays>
}
```

**Victory State:**
```javascript
{
  eyeScale: 'scale-y-50',  // Squinting in joy
  pulseSpeed: 'animate-victory-jump',
  borderColor: 'border-green-400',
  extraElement: <Arms raised + star particles>
}
```

**Sleeping State:**
```javascript
{
  eyeScale: 'scale-y-20',  // Eyes mostly closed
  pulseSpeed: 'animate-pulse-sleeping',  // 4s cycle
  borderColor: 'border-cyan-400/50',
  bgGlow: 'shadow-[0_0_15px_rgba(6,182,212,0.2)]',
  extraElement: <Floating Z particles>
}
```

#### Animation Keyframes

```css
/* Pupil scanning animation */
@keyframes pupil-dart {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(2px, -1px); }
  40% { transform: translate(-2px, 1px); }
  60% { transform: translate(1px, 2px); }
  80% { transform: translate(-1px, -2px); }
}

/* Victory jump */
@keyframes victory-jump {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-8px) scale(1.1); }
}

/* Sleeping pulse */
@keyframes pulse-sleeping {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.98); }
}

/* Floating Z's */
@keyframes float-z1 {
  0% { transform: translate(0, 0); opacity: 0; }
  50% { opacity: 0.6; }
  100% { transform: translate(3px, -20px); opacity: 0; }
}
```

### Floating Widget System

#### Draggable Behavior

```javascript
// Mouse down - start dragging
const handleMouseDown = (e) => {
  if (e.target.closest('.control-button')) return;
  
  setIsDragging(true);
  const rect = widgetRef.current.getBoundingClientRect();
  setDragOffset({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  });
};

// Mouse move - update position
useEffect(() => {
  const handleMouseMove = (e) => {
    if (!isDragging) return;

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    // Keep within viewport
    const maxX = window.innerWidth - 200;
    const maxY = window.innerHeight - 200;

    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    });
  };

  if (isDragging) {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', () => setIsDragging(false));
  }

  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', () => setIsDragging(false));
  };
}, [isDragging, dragOffset]);
```

#### Minimize/Maximize

```javascript
const [isMinimized, setIsMinimized] = useState(true);

// Minimized view - small clickable icon
{isMinimized ? (
  <div onClick={() => setIsMinimized(false)}>
    <DipsyStandalone state={dipsyState} size="small" />
  </div>
) : (
  // Expanded view - full interface
  <div>
    <DipsyStandalone state={dipsyState} size="large" />
    <button onClick={() => setIsMinimized(true)}>Minimize</button>
  </div>
)}
```

### Chat Interface

#### Message Types

**User Messages:**
```javascript
<div className="flex justify-end">
  <div className="bg-emerald-600 text-white rounded-xl p-3">
    {message.content}
  </div>
</div>
```

**Assistant Messages:**
```javascript
<div className="flex gap-3">
  <Bot icon />
  <div className="bg-zinc-800/50 rounded-xl p-3">
    <div className="whitespace-pre-wrap">{message.content}</div>
    {message.actions && <ActionButtons />}
  </div>
</div>
```

#### Auto-Scroll Behavior

```javascript
const [stickyScroll, setStickyScroll] = useState(true);

// Auto-scroll when new messages arrive
useEffect(() => {
  if (!stickyScroll) return;
  const el = outRef.current;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}, [messages, stickyScroll]);

// Detect manual scroll
<div
  onScroll={(e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    setStickyScroll(atBottom);
  }}
>
```

#### Keyboard Shortcuts

```javascript
<textarea
  onKeyDown={(e) => {
    // Ctrl/Cmd + Enter to send
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canSend) handleSend();
    }
  }}
/>
```

### Suggestion Chips

Pre-built queries for quick access:

```javascript
const SUGGESTIONS = [
  { title: "Show available loads", prompt: "Show me available loads" },
  { title: "Active drivers", prompt: "Show me active drivers" },
  { title: "In transit loads", prompt: "What loads are in transit?" },
  { title: "Problem loads", prompt: "Show me problem loads" },
  { title: "Today's deliveries", prompt: "What's delivering today?" },
  { title: "Assign driver", prompt: "Assign driver John to load AC-12345" },
];

// Render as clickable chips
{SUGGESTIONS.map((s, i) => (
  <button
    key={i}
    onClick={() => setInput(s.prompt)}
    className="rounded-xl border p-3"
  >
    <div className="font-medium">{s.title}</div>
    <div className="text-xs text-muted">{s.prompt}</div>
  </button>
))}
```

---

## Security & Data Protection

### Row Level Security (RLS)

All database queries respect Supabase RLS policies:

```sql
-- Example RLS policy
CREATE POLICY "Users can only see their org's loads"
  ON loads
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM user_orgs WHERE user_id = auth.uid()
    )
  );
```

Dipsy queries automatically filter by organization:

```javascript
// No manual org filtering needed - RLS handles it
const { data } = await supabase
  .from('loads')
  .select('*');
// Returns only loads for user's organization
```

### Authentication

User authentication is required for all operations:

```javascript
// Get current user
const { data } = await supabase.auth.getUser();
const userId = data?.user?.id;

// Pass userId to operations for audit trail
await assignDriverToLoad(driverName, loadRef, userId);
```

### Input Sanitization

All user inputs are sanitized:

```javascript
function sanitizeInput(input) {
  return input
    .trim()
    .replace(/[<>]/g, '')  // Remove HTML tags
    .slice(0, 500);        // Limit length
}
```

### SQL Injection Prevention

Supabase client SDK uses parameterized queries:

```javascript
// ✅ Safe - parameterized
const { data } = await supabase
  .from('loads')
  .select('*')
  .eq('reference', userInput);

// ❌ Unsafe - never use raw SQL with user input
// const { data } = await supabase.rpc('raw_query', {
//   query: `SELECT * FROM loads WHERE reference = '${userInput}'`
// });
```

### Rate Limiting

Implement rate limiting to prevent abuse:

```javascript
// In production, add rate limiting
const rateLimit = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = rateLimit.get(userId) || [];
  
  // Remove requests older than 1 minute
  const recentRequests = userRequests.filter(
    time => now - time < 60000
  );
  
  // Check if exceeded limit (100 requests/minute)
  if (recentRequests.length >= 100) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimit.set(userId, recentRequests);
  return true;
}
```

### Data Privacy

Sensitive information is filtered:

```javascript
function sanitizeDriverData(driver) {
  return {
    id: driver.id,
    full_name: driver.full_name,
    phone: driver.phone,
    status: driver.status,
    // Exclude sensitive fields:
    // - license_number
    // - social_security
    // - bank_account
  };
}
```

---

## Extension & Customization

### Adding New Query Types

#### Step 1: Add Pattern Matching

In `dipsyIntelligence.js`:

```javascript
// Add to processDipsyQuery()
if (msg.match(/show (me )?truck (.*)/i)) {
  const match = msg.match(/show (me )?truck (.*)/i);
  const truckNumber = match[2].trim();
  return await getTruckDetails(truckNumber);
}
```

#### Step 2: Create Query Function

```javascript
async function getTruckDetails(truckNumber) {
  const { data, error } = await supabase
    .from('trucks')
    .select(`
      *,
      drivers (
        full_name,
        status
      )
    `)
    .eq('truck_number', truckNumber)
    .single();

  if (error || !data) {
    return {
      success: false,
      message: `I couldn't find truck "${truckNumber}".`
    };
  }

  return {
    success: true,
    data: data,
    message: `Found truck ${data.truck_number}!`,
    formatted: formatTruckDetails(data),
    actions: [
      { label: 'View Truck', action: 'navigate', path: `/trucks/${data.id}` }
    ]
  };
}
```

#### Step 3: Create Formatter

```javascript
function formatTruckDetails(truck) {
  const driver = truck.drivers?.[0];
  
  return `
**Truck ${truck.truck_number}**
Status: ${truck.status}
Make: ${truck.make}
Model: ${truck.model}
Year: ${truck.year}
VIN: ${truck.vin}

${driver ? `👤 Assigned Driver: ${driver.full_name}` : '⚠️ No driver assigned'}
  `.trim();
}
```

### Custom Actions

Add new action types:

```javascript
// In DipsyAIAssistant.jsx
const handleAction = (action) => {
  switch (action.action) {
    case 'navigate':
      navigate(action.path);
      break;
    
    case 'assign':
      openAssignModal(action.loadId);
      break;
    
    case 'copy':
      navigator.clipboard.writeText(action.content);
      break;
    
    // ✨ Add new action type
    case 'download':
      downloadFile(action.url, action.filename);
      break;
    
    case 'email':
      openEmailComposer(action.to, action.subject, action.body);
      break;
  }
};
```

### Integrating External APIs

Add external data sources:

```javascript
async function getWeatherForRoute(origin, destination) {
  // Call weather API
  const weather = await fetch(
    `https://api.weather.com/route?from=${origin}&to=${destination}`
  );
  
  return {
    success: true,
    message: `Weather along route ${origin} → ${destination}`,
    formatted: formatWeatherData(weather.data)
  };
}

// Add pattern in processDipsyQuery()
if (msg.match(/weather (for|along) (.*)/i)) {
  const match = msg.match(/weather (for|along) (.*)/i);
  const route = match[2].trim();
  return await getWeatherForRoute(route);
}
```

### Custom Animations

Add new Dipsy states:

```javascript
// In DipsyStandalone.jsx
case 'calculating':
  return {
    eyeScale: 'scale-100',
    pupilPosition: 'animate-pupil-spin',
    pulseSpeed: 'animate-pulse-fast',
    borderColor: 'border-purple-400',
    icon: <Calculator className="animate-spin" />,
    extraElement: <Numbers floating around>,
    eyebrowLeft: '-top-1 -left-0.5 rotate-12',
    eyebrowRight: '-top-1 -right-0.5 -rotate-12',
    mouthShape: 'concentrated',
    headTilt: 'rotate-5',
    blinkSpeed: 'animate-blink-fast'
  };

// Add keyframes
@keyframes pupil-spin {
  0% { transform: rotate(0deg) translateX(2px); }
  100% { transform: rotate(360deg) translateX(2px); }
}
```

---

## API Reference

### processDipsyQuery()

Main intelligence function:

```typescript
async function processDipsyQuery(
  userMessage: string,
  userId: string
): Promise<DipsyResponse>

interface DipsyResponse {
  success: boolean;
  message: string;
  data?: any;
  formatted?: string;
  actions?: Action[];
  needsAI?: boolean;
  error?: string;
}

interface Action {
  label: string;
  action: 'navigate' | 'assign' | 'copy' | string;
  path?: string;
  loadId?: string;
  content?: string;
  [key: string]: any;
}
```

### Database Query Functions

```typescript
// Load operations
async function getLoadDetails(loadRef: string): Promise<DipsyResponse>
async function getAvailableLoads(): Promise<DipsyResponse>
async function getInTransitLoads(): Promise<DipsyResponse>
async function getProblemLoads(): Promise<DipsyResponse>
async function getLoadsByDestination(dest: string): Promise<DipsyResponse>
async function getLoadsByOrigin(origin: string): Promise<DipsyResponse>

// Driver operations
async function getDriverDetails(name: string): Promise<DipsyResponse>
async function getActiveDrivers(): Promise<DipsyResponse>
async function getAssignedDrivers(): Promise<DipsyResponse>
async function getDriverForLoad(loadRef: string): Promise<DipsyResponse>

// Assignment operations
async function assignDriverToLoad(
  driverName: string,
  loadRef: string,
  userId: string
): Promise<DipsyResponse>

async function unassignDriverFromLoad(
  loadRef: string,
  userId: string
): Promise<DipsyResponse>

// Status updates
async function updateLoadStatus(
  loadRef: string,
  newStatus: string,
  userId: string
): Promise<DipsyResponse>

// Analytics
async function getLoadCountByStatus(status: string): Promise<DipsyResponse>
async function getTodaysDeliveries(): Promise<DipsyResponse>
async function getWeeklySummary(): Promise<DipsyResponse>
async function calculateLoadMetrics(msg: string): Promise<DipsyResponse>
```

### Dipsy Context API

```typescript
interface DipsyContextType {
  state: DipsyState;
  setState: (state: DipsyState) => void;
  setThinking: () => void;
  setConfident: () => void;
  setLightbulb: () => void;
  setCelebrating: () => void;
  setLearning: () => void;
  setIdle: () => void;
  setSleeping: () => void;
}

type DipsyState = 
  | 'idle'
  | 'sleeping'
  | 'thinking'
  | 'confident-victory'
  | 'confident-lightbulb'
  | 'celebrating'
  | 'learning';

// Usage
const dipsy = useDipsy();
dipsy.setThinking();
```

---

## Troubleshooting

### Common Issues

#### Issue: "I couldn't find load X"

**Cause:** Load reference doesn't match database
**Solution:** Check exact reference format in database

```javascript
// Debug query
const { data } = await supabase
  .from('loads')
  .select('reference')
  .limit(5);
console.log('Sample references:', data);
```

#### Issue: Dipsy not responding

**Cause:** JavaScript error in intelligence engine
**Solution:** Check browser console for errors

```javascript
// Add error logging
try {
  const result = await processDipsyQuery(msg, userId);
} catch (error) {
  console.error('Dipsy error:', error);
  console.error('Stack:', error.stack);
}
```

#### Issue: Animations not working

**Cause:** CSS keyframes not loading
**Solution:** Check Tailwind configuration

```javascript
// In tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'pulse-slow': 'pulse-slow 3s ease-in-out infinite',
        // ... other animations
      }
    }
  }
}
```

#### Issue: Database permissions error

**Cause:** RLS policy blocking access
**Solution:** Check Supabase RLS policies

```sql
-- Test policy
SELECT * FROM loads WHERE id = 'some-id';
-- If returns nothing, check RLS policy
```

#### Issue: OpenAI fallback not working

**Cause:** API key not configured
**Solution:** Add API key to environment

```bash
# .env.local
VITE_OPENAI_API_KEY=sk-...
```

### Debugging Tips

#### Enable verbose logging

```javascript
// In dipsyIntelligence.js
const DEBUG = true;

if (DEBUG) {
  console.log('Input:', userMessage);
  console.log('Normalized:', normalizedMessage);
  console.log('Match result:', match);
  console.log('Query result:', result);
}
```

#### Test individual functions

```javascript
// In browser console
import { processDipsyQuery } from './lib/dipsyIntelligence';

// Test specific query
const result = await processDipsyQuery("show me available loads", "user-id");
console.log(result);
```

#### Check Supabase connection

```javascript
// Test connection
const { data, error } = await supabase
  .from('loads')
  .select('count')
  .limit(1);

if (error) {
  console.error('Supabase connection error:', error);
} else {
  console.log('Connection OK');
}
```

---

## Performance Optimization

### Query Optimization

**Use selective columns:**
```javascript
// ❌ Slow - returns all columns
.select('*')

// ✅ Fast - returns only needed columns
.select('id, reference, status, origin, destination')
```

**Add indexes:**
```sql
-- In Supabase SQL Editor
CREATE INDEX idx_loads_status ON loads(status);
CREATE INDEX idx_loads_reference ON loads(reference);
CREATE INDEX idx_drivers_full_name ON drivers(full_name);
```

**Limit results:**
```javascript
// Always limit results
.limit(10)
.order('created_at', { ascending: false })
```

### Caching Strategy

Implement caching for frequently accessed data:

```javascript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function getCachedData(key, fetchFn) {
  const cached = cache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await fetchFn();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

// Usage
const loads = await getCachedData('available-loads', () =>
  supabase.from('loads').select('*').eq('status', 'AVAILABLE')
);
```

### Bundle Size

Dipsy's total JavaScript size:
- `dipsyIntelligence.js`: ~15KB
- `DipsyAIAssistant.jsx`: ~8KB
- `DipsyStandalone.jsx`: ~12KB
- `DipsyFloating.jsx`: ~6KB
- **Total**: ~41KB (minified + gzipped: ~12KB)

---

## Conclusion

Dipsy represents a new paradigm in TMS user interfaces - one where natural language becomes the primary interaction model. By combining regex-based intent recognition with LLM fallback, direct database access, and an expressive animated character, Dipsy provides a powerful yet approachable way for dispatchers to manage their operations.

The system is designed to be:
- **Extensible**: Easy to add new query types and actions
- **Performant**: Direct database access with smart caching
- **Secure**: RLS-compliant with proper authentication
- **Intuitive**: Natural language + visual feedback
- **Reliable**: Deterministic database operations with AI fallback

As AI assistants become more prevalent in enterprise software, Dipsy demonstrates how they can be both functionally powerful and delightfully human.

---

**Version**: 1.0.0  
**Last Updated**: November 2024  
**Maintainer**: Atlas Command Development Team
