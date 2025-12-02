// src/components/DipsyAIAssistant.jsx
// Enhanced AI Assistant with Dipsy Intelligence
// Handles both database queries and OpenAI conversations
// Now with PROPER stateful conversation support via conversation_state!
// And secure document reading via Supabase Edge Function (read-document)

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Loader2,
  Trash2,
  Clipboard,
  Sparkles,
  ArrowDown,
  ExternalLink,
  Paperclip,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAIStream from "../hooks/useAIStream";
import { useDipsy } from "../layout/MainLayout";
import { supabase } from "../lib/supabase";
import {
  askDipsy,
  loadDipsyConversationState,
} from "../lib/dipsyTextClient";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

const SUGGESTIONS = [
  { title: "Show available loads", prompt: "Show me available loads" },
  { title: "Active drivers", prompt: "Show me active drivers" },
  {
    title: "Create a load",
    prompt: "Create load from Chicago to Atlanta, rate $2500",
  },
  { title: "Find drivers", prompt: "Find me an available driver" },
  { title: "Problem loads", prompt: "Show me problem loads" },
  { title: "Assign driver", prompt: "Assign driver John to load AC-12345" },
];

export default function DipsyAIAssistant({ className = "" }) {
  const dipsy = useDipsy();
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stickyScroll, setStickyScroll] = useState(true);
  const [userId, setUserId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  // ✅ CRITICAL: Store the full conversation_state from the Edge Function
  // This includes conversationHistory AND context memory (lastLoadReference, lastDriverName, etc.)
  const [conversationState, setConversationState] = useState(null);

  // Simple message count for UI display
  const [messageCount, setMessageCount] = useState(0);

  // 💰 Cost tracking
  const [costStats, setCostStats] = useState({
    freeQueries: 0,
    paidQueries: 0,
    estimatedCost: 0,
  });

  const outRef = useRef(null);
  const fileInputRef = useRef(null);

  // Get current user (not critical for Dipsy, but leaving your existing logic)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      setUserId(uid);
    });
  }, []);

  // ✅ NEW: Load any existing conversation_state from localStorage on mount
  useEffect(() => {
    const existingState = loadDipsyConversationState(null);
    if (existingState) {
      console.info(
        "[DipsyAIAssistant] Loaded conversation_state from storage:",
        existingState
      );
      setConversationState(existingState);

      const historyLength =
        existingState?.conversationHistory?.length || 0;
      if (historyLength > 0) {
        setMessageCount(historyLength);
      }
    }
  }, []);

  // Auto-scroll when messages change
  useEffect(() => {
    if (!stickyScroll) return;
    const el = outRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, stickyScroll]);

  const canSend = input.trim().length > 0 && !isProcessing;

  const addMessage = (
    role,
    content,
    data = null,
    actions = null,
    usedAI = false
  ) => {
    setMessages((prev) => [
      ...prev,
      { role, content, data, actions, usedAI, timestamp: new Date() },
    ]);

    // Update cost stats
    if (role === "assistant" && content) {
      setCostStats((prev) => ({
        freeQueries: prev.freeQueries + (usedAI ? 0 : 1),
        paidQueries: prev.paidQueries + (usedAI ? 1 : 0),
        estimatedCost: prev.estimatedCost + (usedAI ? 0.00035 : 0),
      }));
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("📎 File selected:", file.name, file.type, file.size);
    setSelectedFile(file);
  };

  const uploadFileToStorage = async (file) => {
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.${fileExt}`;
      const filePath = `dipsy-uploads/${fileName}`;

      console.log("📤 Uploading to Supabase Storage:", filePath);

      const { data, error } = await supabase.storage
        .from("documents")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (error) throw error;

      const {
        data: { publicUrl },
      } = supabase.storage.from("documents").getPublicUrl(filePath);

      console.log("✅ File uploaded:", publicUrl);

      return { success: true, url: publicUrl, path: filePath };
    } catch (error) {
      console.error("❌ Upload error:", error);
      return { success: false, error: error.message };
    }
  };

  const extractTextFromPDF = async (file) => {
    try {
      console.log("📄 Extracting text from PDF...");

      const pdfjsLib = await import("pdfjs-dist");
      const workerSrc = "/pdf.worker.min.mjs";
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      });

      const pdf = await loadingTask.promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(" ");
        fullText += pageText + "\n";
      }

      console.log("✅ Extracted text from PDF, length:", fullText.length);

      return { success: true, text: fullText };
    } catch (error) {
      console.error("❌ PDF extraction error:", error);
      return { success: false, error: error.message };
    }
  };

  // 🔐 Read document via direct fetch to Supabase Edge Function (read-document)
  // This avoids the x-client-info CORS issue from supabase.functions.invoke.
  const readDocumentWithAI = async (fileUrl, fileName, fileObject = null) => {
    try {
      console.log("🔮 Reading document via Supabase read-document function:", {
        fileUrl,
        fileName,
      });

      const isPDF = fileName.toLowerCase().endsWith(".pdf");

      if (!isPDF) {
        // For now, we support deep reading for PDFs only.
        return {
          success: false,
          error:
            "Right now I can only deeply read PDF rate confirmations. Please upload a PDF.",
        };
      }

      if (!fileObject) {
        return {
          success: false,
          error:
            "No file object provided for PDF reading. Please try uploading the document again.",
        };
      }

      // 1) Extract text from the PDF in the browser
      const extractResult = await extractTextFromPDF(fileObject);

      if (!extractResult.success) {
        throw new Error(`Failed to extract PDF text: ${extractResult.error}`);
      }

      const rawText = extractResult.text;

      // 2) Send the extracted text to the Supabase Edge Function via direct fetch
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error(
          "VITE_SUPABASE_URL is not configured in the frontend environment."
        );
      }

      // Get the current session for authorization
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("You must be logged in to read documents.");
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/read-document`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            raw_text: rawText,
            file_name: fileName,
            file_url: fileUrl,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[read-document] HTTP error from function:",
          response.status,
          errorText
        );
        throw new Error(
          `Function error (${response.status}): ${errorText || "Unknown error"}`
        );
      }

      const data = await response.json();

      const analysisText =
        data?.analysis_text ||
        "I processed the document, but didn't get a detailed analysis back.";

      console.log(
        "✅ Document analysis received from read-document, length:",
        analysisText.length
      );

      return { success: true, text: analysisText };
    } catch (error) {
      console.error("❌ AI reading error (read-document):", error);
      return { success: false, error: error.message };
    }
  };

  const handleSend = async (text) => {
    const userMessage = (text ?? input).trim();
    const fileToUpload = selectedFile;

    setInput("");
    setSelectedFile(null);

    const finalMessage =
      fileToUpload && !userMessage
        ? "I'm uploading a document for you to read"
        : userMessage;

    if (!finalMessage && !fileToUpload) return;

    if (fileToUpload) {
      addMessage("user", `${finalMessage}\n📎 ${fileToUpload.name}`);
    } else {
      addMessage("user", finalMessage);
    }

    setIsProcessing(true);

    if (dipsy.state === "sleeping") {
      dipsy.setIdle();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    dipsy.setThinking();

    try {
      // 🆕 If there's a file, upload and read it first
      if (fileToUpload) {
        addMessage(
          "assistant",
          "📤 Uploading your document...",
          null,
          null,
          false
        );

        const uploadResult = await uploadFileToStorage(fileToUpload);

        if (!uploadResult.success) {
          addMessage(
            "assistant",
            `❌ Failed to upload file: ${uploadResult.error}`
          );
          dipsy.setIdle();
          setIsProcessing(false);
          return;
        }

        addMessage(
          "assistant",
          `✅ Document uploaded! Now reading it with AI...`,
          null,
          null,
          false
        );

        const readResult = await readDocumentWithAI(
          uploadResult.url,
          fileToUpload.name,
          fileToUpload
        );

        if (!readResult.success) {
          addMessage(
            "assistant",
            `❌ Failed to read document: ${readResult.error}\n\nBut here's the file: ${uploadResult.url}`
          );
          dipsy.setIdle();
          setIsProcessing(false);
          return;
        }

        // Add document extraction to conversation state context
        // so Dipsy "remembers" it for follow-up questions
        const docMemoryMessage = {
          role: "assistant",
          content: `I read the document and found:\n\n${readResult.text}`,
        };

        // Update conversation state with document memory
        setConversationState((prev) => {
          const nextState = {
            ...prev,
            conversationHistory: [
              ...(prev?.conversationHistory || []),
              docMemoryMessage,
            ],
          };
          console.log(
            "💾 Updated conversation_state with document memory:",
            nextState
          );
          return nextState;
        });

        addMessage(
          "assistant",
          `📄 **I read your document!**\n\n${readResult.text}\n\n---\n\n💡 **What would you like me to do?**\nSay "create the load" or "make the load" and I'll set it up for you!`,
          null,
          null,
          true
        );

        setMessageCount((prev) => prev + 2);
        dipsy.setLightbulb();
        setTimeout(() => dipsy.setIdle(), 2000);
        setIsProcessing(false);
        return;
      }

      // ================================
      // ✅ Normal text query (no file)
      //    Pass conversation_state for context memory!
      // ================================
      console.log(
        "📤 Sending to Dipsy with conversation_state:",
        conversationState
      );

      const result = await askDipsy(finalMessage, conversationState, null);

      console.log("📝 Dipsy text result:", result);

      if (result.ok) {
        const answer = result.answer || "I wasn't able to generate a reply.";
        const usedAI = !!result.used_tool;

        dipsy.setLightbulb();

        addMessage("assistant", answer, null, null, usedAI);

        // ✅ CRITICAL: Store the updated conversation_state for the next call
        if (result.conversation_state) {
          setConversationState(result.conversation_state);
          console.log(
            "💾 Updated conversation_state from dipsy-text:",
            result.conversation_state
          );

          const historyLength =
            result.conversation_state?.conversationHistory?.length || 0;
          setMessageCount(historyLength);
        }

        setTimeout(() => dipsy.setIdle(), 2000);
      } else {
        addMessage(
          "assistant",
          result.error ||
            "I couldn't reach my text brain just now. Please try again in a moment.",
          null,
          null,
          false
        );
        dipsy.setIdle();
      }
    } catch (error) {
      console.error("Dipsy error:", error);
      addMessage("assistant", `Oops! Something went wrong: ${error.message}`);
      dipsy.setIdle();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSuggestion = (s) => {
    setInput(s.prompt);
  };

  const handleCopy = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
      dipsy.setCelebrating();
      setTimeout(() => dipsy.setIdle(), 1500);
    } catch {}
  };

  const handleAction = (action) => {
    if (action.action === "navigate" && action.path) {
      navigate(action.path);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setCostStats({ freeQueries: 0, paidQueries: 0, estimatedCost: 0 });
    setConversationState(null); // ✅ Clear conversation state (including context memory)
    setMessageCount(0);
    setSelectedFile(null);
    dipsy.setIdle();
  };

  // Build context indicator string
  const getContextIndicator = () => {
    const ctx = conversationState?.context;
    if (!ctx) return null;

    const parts = [];
    if (ctx.lastLoadReference) {
      parts.push(`Load: ${ctx.lastLoadReference}`);
    }
    if (ctx.lastDriverName) {
      parts.push(`Driver: ${ctx.lastDriverName}`);
    }
    return parts.length > 0 ? parts.join(" • ") : null;
  };

  const contextIndicator = getContextIndicator();

  return (
    <div
      className={cx(
        "rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-xl backdrop-blur",
        "flex flex-col overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/50 p-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Bot className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-sm">
            <div className="font-medium text-zinc-100">Dipsy</div>
            <div className="text-xs text-zinc-400">
              Your intelligent dispatch assistant
              {messageCount > 0 && (
                <span className="ml-2 text-emerald-400">
                  • {messageCount} messages in context
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Cost Stats */}
          {costStats.freeQueries + costStats.paidQueries > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-emerald-400 font-medium">
                  {costStats.freeQueries}
                </span>
                <span className="text-zinc-400">free</span>
              </div>
              {costStats.paidQueries > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="text-amber-400 font-medium">
                    {costStats.paidQueries}
                  </span>
                  <span className="text-zinc-400">paid</span>
                  <span className="text-amber-400 font-medium">
                    (${costStats.estimatedCost.toFixed(4)})
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
            title="Clear"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Context Memory Indicator */}
      {contextIndicator && (
        <div className="border-b border-zinc-800/50 px-3 py-2 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-emerald-400">🧠 Context:</span>
            <span className="text-zinc-300">{contextIndicator}</span>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {messages.length === 0 && (
        <div className="border-b border-zinc-800/50">
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSuggestion(s)}
                className="group flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:bg-zinc-900"
                title={s.title}
              >
                <div className="mt-0.5 rounded-md bg-emerald-500/15 p-1.5">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    {s.title}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {s.prompt}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={outRef}
        className="min-h-[220px] max-h-[50vh] overflow-auto p-4 space-y-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
          setStickyScroll(atBottom);
        }}
      >
        {messages.length === 0 && (
          <div className="text-zinc-400 text-sm text-center py-8">
            👋 Hi! I'm Dipsy, your AI dispatch assistant. Ask me about loads,
            drivers, assignments, or create new loads!
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cx(
              "flex gap-3",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-emerald-400" />
              </div>
            )}

            <div
              className={cx(
                "max-w-[80%] rounded-xl p-3 text-sm",
                msg.role === "user"
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800/50 text-zinc-100"
              )}
            >
              {msg.role === "assistant" && msg.usedAI && (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  <span>💰</span>
                  <span>AI API Used</span>
                </div>
              )}

              {msg.role === "assistant" && !msg.usedAI && msg.content && (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  <span>✅</span>
                  <span>Free Query</span>
                </div>
              )}

              <div className="whitespace-pre-wrap">{msg.content}</div>

              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.actions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => handleAction(action)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
                    >
                      {action.label}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              {msg.role === "assistant" && (
                <button
                  onClick={() => handleCopy(msg.content)}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
                >
                  <Clipboard className="h-3 w-3" />
                  Copy
                </button>
              )}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        {!stickyScroll && (
          <button
            type="button"
            onClick={() => {
              const el = outRef.current;
              if (!el) return;
              el.scrollTop = el.scrollHeight;
              setStickyScroll(true);
            }}
            className="sticky bottom-0 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 backdrop-blur"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800/50 p-3">
        {selectedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-zinc-800/50 p-2">
            <Paperclip className="h-4 w-4 text-emerald-400" />
            <span className="text-sm text-zinc-300">{selectedFile.name}</span>
            <button
              onClick={() => setSelectedFile(null)}
              className="ml-auto text-xs text-zinc-400 hover:text-zinc-300"
            >
              Remove
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Dipsy... (e.g., 'Create a load' then 'Assign that driver to that load')"
            rows={2}
            className="min-h-[44px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (canSend) handleSend();
              }
            }}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-[44px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Upload rate confirmation (PDF or image)"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {!isProcessing ? (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => handleSend()}
              className={cx(
                "inline-flex h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium",
                canSend
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              )}
              title="Send (Ctrl/Cmd+Enter)"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-[44px] items-center gap-2 rounded-xl bg-zinc-800 px-4 text-sm font-medium text-zinc-400 cursor-not-allowed"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing
            </button>
          )}
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 text-center">
          Press <kbd className="rounded bg-zinc-800 px-1">Ctrl/Cmd+Enter</kbd>{" "}
          to send •{" "}
          {contextIndicator ? (
            <span className="text-emerald-400">
              🧠 I remember: {contextIndicator}
            </span>
          ) : messageCount > 0 ? (
            <span className="text-emerald-400">
              Context active: I remember our conversation!
            </span>
          ) : (
            <span>
              Try: "Create a load" then "Assign Black Panther to that load"
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
