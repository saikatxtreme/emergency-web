import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// --- LEAFLET ICON FIX ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const SERVER_URL = "https://emergency-server-uybe.onrender.com"; 

const urlParams = new URLSearchParams(window.location.search);
const QR_ID = urlParams.get('id') || "default-car"; 

// Initialize Socket with robust reconnection settings
const socket = io(SERVER_URL, {
  transports: ['websocket'], 
  reconnection: true, 
  reconnectionAttempts: Infinity,
  autoConnect: true,
});

function MapUpdater({ location }) {
  const map = useMap();
  useEffect(() => {
    if (location) map.flyTo(location, 15);
  }, [location, map]);
  return null;
}

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [chat, setChat] = useState([]);
  const [inputText, setInputText] = useState("");
  const [location, setLocation] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    // --- 1. CONNECTION LOGIC ---
    const handleConnect = () => {
        console.log("Connected. Joining:", QR_ID);
        setStatus("Connected to Owner");
        socket.emit("join-family", QR_ID);
        
        // If we have location already, send it immediately
        if (location) {
             socket.emit("scan-qr", { qrId: QR_ID, location: {lat: location[0], lng: location[1]} });
        }
    };

    socket.on("connect", handleConnect);
    
    // Heartbeat: Check connection every 5 seconds and rejoin if needed
    const heartbeat = setInterval(() => {
        if (socket.connected) {
            socket.emit("join-family", QR_ID);
        } else {
            socket.connect();
        }
    }, 5000);

    socket.on("receive-chat", (data) => setChat(prev => [...prev, data]));
    
    socket.on("receive-audio", (audioBase64) => {
        console.log("Audio Received");
        try {
            const audio = new Audio(audioBase64);
            audio.play().catch(e => console.log("Autoplay blocked"));
        } catch (e) { console.error(e); }
    });

    socket.on("disconnect", () => setStatus("Disconnected... Reconnecting"));

    // --- 2. GPS LOGIC ---
    let watchId;
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            const newLoc = [pos.coords.latitude, pos.coords.longitude];
            setLocation(newLoc);
            // Only emit if connected to avoid queue buildup
            if(socket.connected) {
                socket.emit("scan-qr", { qrId: QR_ID, location: {lat: newLoc[0], lng: newLoc[1]} });
            }
        }, (err) => console.log("GPS Error", err), { enableHighAccuracy: true });
    }

    return () => {
        clearInterval(heartbeat);
        socket.off("connect");
        socket.off("receive-chat");
        socket.off("receive-audio");
        socket.off("disconnect");
        if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, []); // Run once on mount

  // --- 3. ALERT LOGIC (Triggers Ringing on Phone) ---
  const triggerAlert = () => {
      if(window.confirm("🚨 EMERGENCY ALERT \n\nThis will ring the owner's phone immediately. Are you sure?")) {
          socket.emit("trigger-alert", QR_ID);
          alert("Signal Sent! The owner is being alerted.");
      }
  };

  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        const chunks = [];
        mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorderRef.current.onstop = () => {
             const blob = new Blob(chunks, { type: 'audio/webm' });
             const reader = new FileReader();
             reader.readAsDataURL(blob);
             reader.onloadend = () => {
                 socket.emit("send-audio", { qrId: QR_ID, audioBase64: reader.result });
             };
        };
        mediaRecorderRef.current.start();
        setIsRecording(true);
    } catch (err) { alert("Mic blocked! Please allow microphone access."); }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setIsRecording(false);
  };

  const toggleMic = () => { if (isRecording) stopRecording(); else startRecording(); };

  const sendText = (e) => {
    e.preventDefault();
    if (!inputText) return;
    const msg = { qrId: QR_ID, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg);
    setChat(prev => [...prev, msg]); 
    setInputText("");
  };

  return (
    <div style={styles.container}>
      {location ? (
          <MapContainer center={location} zoom={13} style={styles.map} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={location}><Popup>Vehicle Location</Popup></Marker>
            <MapUpdater location={location} />
          </MapContainer>
      ) : <div style={styles.mapPlaceholder}>Requesting GPS Location...</div>}

      <button onClick={triggerAlert} style={styles.alertBtn} title="Ring Owner's Phone">🚨</button>

      <div style={styles.overlay}>
        <div style={styles.header}><div style={styles.statusDot}></div> {status}</div>

        <div style={styles.chatBox}>
            {chat.map((msg, i) => (
                <div key={i} style={msg.sender === "Helper" ? styles.myMsg : styles.theirMsg}>
                    <b>{msg.sender}:</b> {msg.text}
                </div>
            ))}
        </div>

        <form onSubmit={sendText} style={styles.inputForm}>
            <input value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type message..." style={styles.input} />
            <button type="submit" style={styles.sendBtn}>➤</button>
        </form>

        <button 
            onClick={toggleMic}
            style={{...styles.micBtn, background: isRecording ? "red" : "#D32F2F", animation: isRecording ? "pulse 1s infinite" : "none"}}
        >
            {isRecording ? "🛑" : "🎙️"}
        </button>
        <style>{`@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }`}</style>
      </div>
    </div>
  );
}

const styles = {
  container: { height: "100vh", display: "flex", flexDirection: "column", position: 'relative', overflow: 'hidden' },
  map: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 },
  mapPlaceholder: { position: "absolute", width: "100%", height: "100%", background: "#222", color: "white", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0 },
  alertBtn: { position: 'absolute', top: 20, right: 20, zIndex: 999, background: 'red', color: 'white', border: 'none', width: '60px', height: '60px', fontSize: '24px', borderRadius: '50%', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlay: { zIndex: 10, position: "absolute", bottom: 0, width: "100%", height: "60%", background: "linear-gradient(to top, rgba(0,0,0,0.9) 60%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 20 },
  header: { position: "absolute", top: -300, left: 20, background: "rgba(0,0,0,0.7)", color: "white", padding: "10px 20px", borderRadius: 20 },
  statusDot: { display: "inline-block", width: 10, height: 10, background: "#0f0", borderRadius: "50%", marginRight: 5 },
  chatBox: { flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "250px" },
  myMsg: { alignSelf: "flex-end", background: "#007AFF", color: "white", padding: "8px 12px", borderRadius: "15px 15px 0 15px" },
  theirMsg: { alignSelf: "flex-start", background: "rgba(255,255,255,0.2)", color: "white", padding: "8px 12px", borderRadius: "15px 15px 15px 0" },
  inputForm: { display: "flex", padding: "0 20px 10px", gap: 10 },
  input: { flex: 1, padding: 10, borderRadius: 20, border: "none" },
  sendBtn: { borderRadius: "50%", width: 40, height: 40, border: "none", background: "#007AFF", color: "white", cursor: "pointer" },
  micBtn: { width: 80, height: 80, borderRadius: "50%", border: "4px solid white", margin: "0 auto", fontSize: 30, cursor: "pointer", color: "white" }
};

export default App;