import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { FaMicrophone, FaPaperPlane, FaExclamationTriangle, FaMapMarkerAlt, FaShieldAlt } from "react-icons/fa";
import "./App.css"; 

// --- CONFIG ---
const SERVER_URL = "https://emergency-server-uybe.onrender.com";

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnectionAttempts: 10,
});

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [qrId, setQrId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  // --- SCROLL TO BOTTOM ---
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

  // --- INITIAL SETUP ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    const handleJoin = () => {
        if (id) {
            socket.emit("join-room", id);
            setStatus("Connected 🟢");
            setIsConnected(true);
            // Auto-send location on first load
            updateLocation(id, true);
        } else {
            setStatus("Invalid QR Code 🔴");
        }
    };

    socket.on("connect", handleJoin);
    if(socket.connected) handleJoin();

    socket.on("disconnect", () => {
        setStatus("Disconnected 🔴");
        setIsConnected(false);
    });

    // --- CHAT LISTENER ---
    socket.on("receive-chat", (data) => {
        setMessages((prev) => [...prev, data]);
    });

    // --- AUDIO LISTENER (FROM MOBILE) ---
    socket.on("receive-audio", (base64Audio) => {
        // Instead of auto-play, add to chat so user can click play
        const audioMsg = {
            sender: "Family",
            type: "audio",
            text: "Sent an audio clip",
            audioData: base64Audio
        };
        setMessages((prev) => [...prev, audioMsg]);
    });

    return () => { 
        socket.off("connect"); 
        socket.off("disconnect");
        socket.off("receive-chat"); 
        socket.off("receive-audio"); 
    };
  }, []);

  // --- SEND LOCATION (MANUAL & AUTO) ---
  const updateLocation = (idToUse = qrId, silent = false) => {
    if (!idToUse) return;
    if ("geolocation" in navigator) {
        if(!silent) alert("Updating Location... Please allow GPS.");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                socket.emit("critical-alert", {
                    qrId: idToUse,
                    message: "Location Updated",
                    location: { latitude, longitude }
                });
                if(!silent) alert("Location Sent! ✅");
            },
            (err) => {
                console.error(err);
                if(!silent) alert("Could not get location. Check permissions.");
            },
            { enableHighAccuracy: true }
        );
    }
  };

  // --- AUDIO RECORDING (TO MOBILE) ---
  const startRecording = async (e) => {
    e.preventDefault();
    try {
      if (navigator.vibrate) navigator.vibrate(50);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const base64 = reader.result;
            socket.emit("send-audio", { qrId, audioBase64: base64 });
            
            // Add my own audio to chat for confirmation
            setMessages(prev => [...prev, { sender: "Helper", type: "audio", audioData: base64 }]);
        };
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) { alert("Microphone access denied."); }
  };

  const stopRecording = (e) => {
    e.preventDefault();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // --- TEXT CHAT ---
  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const msg = { qrId, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg);
    setMessages((prev) => [...prev, msg]);
    setInputText("");
  };

  // --- SOS ---
  const triggerSOS = () => {
    if (!qrId) return;
    if(window.confirm("🚨 ARE YOU SURE?\n\nThis will trigger a loud alarm on the owner's phone.")) {
        socket.emit("incoming-alarm", { qrId }); 
        alert("SOS ALARM SENT! 🚨");
    }
  };

  if (!qrId) return <div className="app-container" style={{justifyContent:'center', alignItems:'center'}}><h3>🚫 Invalid QR Code</h3></div>;

  return (
    <div className="app-container">
      {/* 1. HEADER */}
      <div className="header">
        <div className="brand">
            <FaShieldAlt color="#ff4444" size={22} />
            <span>EMERGO ASSIST</span>
        </div>
        <span className={`status-badge ${isConnected ? 'connected' : ''}`}>
            {status}
        </span>
      </div>

      {/* 2. CONTROL GRID */}
      <div className="controls-grid">
        <button className="btn btn-sos" onClick={triggerSOS}>
            <FaExclamationTriangle /> SEND SOS ALERT
        </button>
        
        <button className="btn btn-loc" onClick={() => updateLocation()}>
            <FaMapMarkerAlt /> UPDATE LOC
        </button>

        <button 
            className={`btn btn-mic ${isRecording ? 'recording' : ''}`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
        >
            <FaMicrophone /> {isRecording ? "RELEASE" : "HOLD TO SPEAK"}
        </button>
      </div>

      {/* 3. CHAT STREAM */}
      <div className="chat-area">
        {messages.length === 0 && <div style={{textAlign:'center', color:'#555', marginTop:30}}>Start messaging the owner...</div>}
        
        {messages.map((m, i) => (
            <div key={i} className={`msg ${m.sender === "Helper" ? "me" : "them"}`}>
                <span className="msg-sender">{m.sender}</span>
                
                {/* Text Message */}
                {m.type !== 'audio' && m.text}
                
                {/* Audio Message */}
                {m.type === 'audio' && (
                    <audio controls src={m.audioData} className="audio-player" />
                )}
            </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. INPUT AREA */}
      <form className="input-area" onSubmit={sendMessage}>
        <input 
            className="chat-input"
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            placeholder="Type message..." 
        />
        <button type="submit" className="btn-send"><FaPaperPlane /></button>
      </form>
    </div>
  );
}

export default App;