import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Brain, Lightbulb, Share2, MessageSquare, ArrowRight, 
  Lock, Unlock, Network, Zap, TrendingUp, User, ChevronRight, 
  RefreshCcw, Edit2, Check, X, LayoutDashboard, GraduationCap, Table as TableIcon
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection } from 'firebase/firestore';

/**
 * [환경 설정] 
 * 1. Vercel 배포 시: Environment Variables 사용
 * 2. 대화창 미리보기 시: 시스템 제공 글로벌 변수 사용
 */
let firebaseConfig = null;
let apiKey = "";
const appId = typeof __app_id !== 'undefined' ? __app_id : "socratic-ai-via26";

try {
  // 1. 시스템 제공 변수 우선 확인 (미리보기용)
  if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
    apiKey = ""; // 시스템이 API 키를 자동으로 주입합니다.
  } 
  // 2. Vite 환경 변수 확인 (Vercel 배포용)
  else {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    if (env.VITE_FIREBASE_CONFIG) {
      firebaseConfig = JSON.parse(env.VITE_FIREBASE_CONFIG);
    }
    apiKey = env.VITE_GEMINI_API_KEY || "";
  }
} catch (e) {
  console.error("환경 변수 로딩 실패:", e);
}

// Firebase 서비스 초기화
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.error("Firebase 초기화 에러:", err);
  }
}

const App = () => {
  const [view, setView] = useState('student');
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("학생 (Student)");
  const [userQuery, setUserQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [frictionScore, setFrictionScore] = useState(0);
  const [thoughtMap, setThoughtMap] = useState(null);
  const [maskedAnswer, setMaskedAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [allProfiles, setAllProfiles] = useState([]);
  const messagesEndRef = useRef(null);

  // --- Auth Setup (Rule 3 준수) ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { 
        console.error("Auth Error:", err); 
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // --- 데이터 불러오기 (Student) ---
  useEffect(() => {
    if (!user || !db || view !== 'student') return;
    const profileDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profiles', userName);
    const unsubscribe = onSnapshot(profileDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMessages(data.messages || []);
        setFrictionScore(data.frictionScore || 0);
        setThoughtMap(data.thoughtMap || null);
        setMaskedAnswer(data.maskedAnswer || null);
      }
    }, (err) => console.error("Firestore Error:", err));
    return () => unsubscribe();
  }, [user, userName, view]);

  // --- 데이터 불러오기 (Admin) ---
  useEffect(() => {
    if (!user || !db || view !== 'admin') return;
    const profilesColRef = collection(db, 'artifacts', appId, 'users', user.uid, 'profiles');
    const unsubscribe = onSnapshot(profilesColRef, (qs) => {
      const profiles = [];
      qs.forEach((d) => profiles.push({ id: d.id, ...d.data() }));
      setAllProfiles(profiles);
    }, (err) => console.error("Admin Error:", err));
    return () => unsubscribe();
  }, [user, view]);

  const syncToCloud = async (updatedData) => {
    if (!user || !db) return;
    const profileDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profiles', userName);
    try { await setDoc(profileDocRef, { ...updatedData, lastUpdated: new Date() }, { merge: true }); } 
    catch (err) { console.error("Save Error:", err); }
  };

  const callGemini = async (prompt, isFollowUp = false) => {
    setIsLoading(true);
    setError(null);
    const systemPrompt = `당신은 '소크라테스 AI' 학습 촉진자입니다. 질문에 직접 답하지 말고 학생이 스스로 생각하게 하세요. JSON으로 응답하세요.`;
    const userPayload = isFollowUp ? `학생 답변: "${prompt}"` : `학생 질문: "${prompt}"`;
    
    // API 호출 지수 백오프 구현
    const fetchWithRetry = async (retries = 0) => {
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userPayload }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { 
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  maskedAnswer: { type: "STRING" },
                  reversePrompts: { type: "ARRAY", items: { type: "STRING" } },
                  perspectives: { type: "OBJECT", properties: { scientific: { type: "STRING" }, ethical: { type: "STRING" }, future: { type: "STRING" } } }
                }
              }
            }
          })
        });
        if (!resp.ok && retries < 5) {
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(r => setTimeout(r, delay));
          return fetchWithRetry(retries + 1);
        }
        return await resp.json();
      } catch (e) {
        if (retries < 5) {
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(r => setTimeout(r, delay));
          return fetchWithRetry(retries + 1);
        }
        throw e;
      }
    };

    try {
      const data = await fetchWithRetry();
      return JSON.parse(data.candidates[0].content.parts[0].text);
    } catch (err) {
      console.error("Gemini Error:", err);
      setError("AI 연결에 실패했습니다.");
      return null;
    } finally { setIsLoading(false); }
  };

  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    if (!userQuery.trim()) return;
    const query = userQuery;
    setUserQuery("");
    const newMsgs = [...messages, { type: 'user', text: query }];
    setMessages(newMsgs);
    const res = await callGemini(query);
    if (res) {
      const updatedMsgs = [...newMsgs, { type: 'ai', text: "좋은 질문이야! 이 역질문들에 대해 먼저 생각해보자.", prompts: res.reversePrompts }];
      setMessages(updatedMsgs);
      setMaskedAnswer(res.maskedAnswer);
      setThoughtMap(res.perspectives);
      setFrictionScore(20);
      syncToCloud({ messages: updatedMsgs, maskedAnswer: res.maskedAnswer, thoughtMap: res.perspectives, frictionScore: 20, lastQuery: query });
    }
  };

  const handlePromptClick = async (p) => {
    const newMsgs = [...messages, { type: 'user', text: `생각: ${p}` }];
    setMessages(newMsgs);
    const newFriction = Math.min(frictionScore + 25, 100);
    const res = await callGemini(p, true);
    if (res) {
      const updatedMsgs = [...newMsgs, { type: 'ai', text: "훌륭해! 지식이 깊어지고 있어.", prompts: res.reversePrompts ? res.reversePrompts.slice(0,1) : [] }];
      setMessages(updatedMsgs);
      setFrictionScore(newFriction);
      syncToCloud({ messages: updatedMsgs, frictionScore: newFriction });
    }
  };

  // 설정 부족 시 안내 (미리보기 환경에서는 이 메시지가 나오지 않도록 수정됨)
  if (!firebaseConfig) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md p-8 bg-white rounded-3xl shadow-xl border border-slate-200 text-center">
          <X className="text-red-500 mx-auto mb-4" size={48} />
          <h1 className="text-xl font-bold mb-4">설정 확인 필요</h1>
          <p className="text-slate-600 text-sm mb-6">배포 시 Vercel 설정에 VITE_FIREBASE_CONFIG가 있는지 확인하세요.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold">다시 시도</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-xl text-white"><Brain size={24} /></div>
          <div><h1 className="font-bold text-lg leading-tight">Socratic AI</h1><p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Inquiry Architect</p></div>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl">
           <button onClick={() => setView('student')} className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${view === 'student' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}><GraduationCap size={16} /> 학생</button>
           <button onClick={() => setView('admin')} className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${view === 'admin' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}><LayoutDashboard size={16} /> 교사</button>
        </div>
        <div className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm"><User className="text-blue-600" size={20} /></div></div>
      </header>

      {view === 'student' ? (
        <div className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 flex flex-col h-[calc(100vh-180px)] bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${msg.type === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    {msg.prompts && msg.prompts.map((p, i) => (
                      <button key={i} onClick={() => handlePromptClick(p)} className="mt-2 w-full text-left p-3 text-sm rounded-xl border border-blue-100 bg-blue-50 text-blue-800 transition-all">{p}</button>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <form onSubmit={handleInitialSubmit} className="relative">
                <input type="text" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="질문을 입력하세요..." className="w-full p-4 pr-14 bg-white rounded-2xl border border-slate-200 text-sm" disabled={isLoading}/>
                <button type="submit" className="absolute right-2 top-2 p-2 bg-blue-600 text-white rounded-xl" disabled={isLoading || !userQuery.trim()}><Search size={20} /></button>
              </form>
            </div>
          </section>
          <aside className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-6">
              <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4"><Lock size={18} className="text-orange-500" /> 지식의 핵심</h3>
              <div className={`p-4 rounded-xl relative overflow-hidden ${frictionScore < 80 ? 'bg-slate-100' : 'bg-green-50'}`}>
                <p className={`text-sm leading-relaxed ${frictionScore < 80 ? 'blur-md opacity-20' : 'blur-none opacity-100'}`}>{maskedAnswer || "탐구를 시작하세요."}</p>
                {frictionScore < 80 && <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/50"><p className="text-[10px] font-bold text-slate-500">탐구 게이지 ({frictionScore}/80)</p></div>}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-4 md:p-6 text-center text-slate-400 py-20">교사용 대시보드 (데이터 로딩 중...)</div>
      )}
    </div>
  );
};

export default App;