import React, { useState, useRef, useEffect } from "react";
import { Mic, Send, Loader2, Sparkles, Square } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import InteractionReceipt from "@/components/InteractionReceipt";

const SUGGESTIONS = [
  "Aaj kya important hai?",
  "Tumhe kya yaad hai?",
  "Maine kya miss kiya?",
  "Mere paas kitna paisa phansa hua hai?",
];

export default function PakKhataConversation({ contextPartyId, contextPartyName, compact = false, onAfterResponse }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [processingStage, setProcessingStage] = useState("");
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const audioRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const playAudio = (url) => {
    if (!url || !audioRef.current) return;
    audioRef.current.src = url;
    audioRef.current.play().then(() => setSpeaking(true)).catch(() => {});
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setSpeaking(false);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setInterimText("");
    setLoading(true);
    setListening(false);
    setProcessingStage("Samajh raha hoon...");

    try {
      const response = await base44.functions.invoke("PakKhataOrchestrator", {
        text,
        context_party_id: contextPartyId,
        conversation_history: [...messages, userMsg].map(m => ({ role: m.role, text: m.text })),
        speak: true,
      });
      const aiMsg = {
        role: "ai",
        text: response.data.response_text,
        audio_url: response.data.audio_url,
        intent: response.data.intent,
        action: response.data.action_taken,
        receipt: response.data.receipt,
      };
      setMessages(prev => [...prev, aiMsg]);
      if (aiMsg.audio_url) {
        setTimeout(() => playAudio(aiMsg.audio_url), 200);
      }
      if (onAfterResponse) onAfterResponse(response.data);
      queryClient.invalidateQueries({ queryKey: ["parties"] });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["business-rules"] });
      queryClient.invalidateQueries({ queryKey: ["business-profile"] });
      queryClient.invalidateQueries({ queryKey: ["market-observations"] });
      queryClient.invalidateQueries({ queryKey: ["commitments"] });
      queryClient.invalidateQueries({ queryKey: ["problems"] });
      queryClient.invalidateQueries({ queryKey: ["decisions"] });
      queryClient.invalidateQueries({ queryKey: ["signals"] });
      queryClient.invalidateQueries({ queryKey: ["financial-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["business-events"] });
      queryClient.invalidateQueries({ queryKey: ["business-terms"] });
      queryClient.invalidateQueries({ queryKey: ["business-memories"] });
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "ai",
        text: "Maf karna, kuch masla a gaya. Phir koshish karein.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setProcessingStage("");
    }
  };

  const startListening = () => {
    stopAudio();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "ur-PK";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcriptRef.current = transcript;
      setInterimText(transcript);
      setInput(transcript);
    };

    recognition.onend = () => {
      setListening(false);
      if (transcriptRef.current.trim()) {
        sendMessage(transcriptRef.current.trim());
        transcriptRef.current = "";
      }
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.start();
    setListening(true);
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setListening(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col">
      <audio
        ref={audioRef}
        onPlay={() => setSpeaking(true)}
        onEnded={() => setSpeaking(false)}
        onPause={() => setSpeaking(false)}
        className="hidden"
      />

      {/* Messages */}
      {messages.length > 0 && (
        <div ref={scrollRef} className={`overflow-y-auto space-y-3 mb-3 ${compact ? "max-h-64" : "max-h-[55vh]"}`}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}>
              {msg.role === "ai" && (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  speaking && i === messages.length - 1 ? "bg-emerald-500 animate-pulse" : "bg-emerald-100"
                }`}>
                  <Sparkles className={`w-3.5 h-3.5 ${speaking && i === messages.length - 1 ? "text-white" : "text-emerald-600"}`} />
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white rounded-br-md max-w-[80%]"
                    : "bg-emerald-50 text-slate-800 border border-emerald-100 rounded-bl-md"
                }`}>
                  {msg.text}
                </div>
                {msg.role === "ai" && msg.receipt && (
                  <InteractionReceipt
                    receipt={msg.receipt}
                    audioUrl={msg.audio_url}
                    onPlayAudio={playAudio}
                    speaking={speaking && i === messages.length - 1}
                  />
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start items-end gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {processingStage || "Samajh raha hoon..."}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state with suggestions */}
      {messages.length === 0 && !compact && (
        <div className="flex flex-col items-center justify-center py-4">
          <p className="text-slate-400 text-sm text-center mb-4">
            {contextPartyName ? `${contextPartyName} ke baray mein poochein...` : "Bolo. PakKhata sun raha hai."}
          </p>
          <div className="flex flex-wrap gap-2 justify-center max-w-md">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="px-3 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${
            listening
              ? "bg-red-500 text-white animate-pulse shadow-red-500/30"
              : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/30"
          }`}
        >
          {listening ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-5 h-5" strokeWidth={2.5} />}
        </button>
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={listening ? interimText : input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "Sun raha hoon..." : "Likhein ya bolen..."}
            className="flex-1 px-4 py-3 rounded-full border border-slate-200 text-sm outline-none focus:border-emerald-400 bg-white"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading || listening}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}