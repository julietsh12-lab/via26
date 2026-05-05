import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Brain, Lightbulb, Share2, MessageSquare, ArrowRight, 
  Lock, Unlock, Network, Zap, TrendingUp, User, ChevronRight, 
  RefreshCcw, Edit2, Check, X, LayoutDashboard, GraduationCap, Table as TableIcon
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, query } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'socratic-ai-default';
const apiKey = ""; // API key is provided at runtime

const App = () => {
  // Navigation & User State
  const [view, setView] = useState('student'); // 'student' or 'admin'
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("민준 (Min-jun)");
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  // Student App Logic State
  const [userQuery, setUserQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [frictionScore, setFrictionScore] = useState(0);
  const [thoughtMap, setThoughtMap] = useState(null);
  const [maskedAnswer, setMaskedAnswer] = useState(null);
  const [error, setError] = useState(null);

  // Admin / Database State
  const [allProfiles, setAllProfiles] = useState([]);

  const messagesEndRef = useRef(null);

  // --- Firebase Auth Setup ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // --- Data Persistence: Student View ---
  useEffect(() => {
    if (!user || view !== 'student') return;

    const profileDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profiles', userName);
    const unsubscribe = onSnapshot(profileDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMessages(data.messages || []);
        setFrictionScore(data.frictionScore || 0);
        setThoughtMap(data.thoughtMap || null);
        setMaskedAnswer(data.maskedAnswer || null);
      } else {
        setMessages([]);
        setFrictionScore(0);
        setThoughtMap(null);
        setMaskedAnswer(null);
      }
    }, (err) => console.error("Firestore Error:", err));

    return () => unsubscribe();
  }, [user, userName, view]);

  // --- Data Persistence: Admin/Database View ---
  useEffect(() => {
    if (!user || view !== 'admin') return;

    const profilesColRef = collection(db, 'artifacts', appId, 'users', user.uid, 'profiles');
    const unsubscribe = onSnapshot(profilesColRef, (querySnapshot) => {
      const profiles = [];
      querySnapshot.forEach((doc) => {
        profiles.push({ id: doc.id, ...doc.data() });
      });
      setAllProfiles(profiles);
    }, (err) => console.error("Admin Load Error:", err));

    return () => unsubscribe();
  }, [user, view]);

  const syncToCloud = async (updatedData) => {
    if (!user) return;
    const profileDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profiles', userName);
    try {
      await setDoc(profileDocRef, { ...updatedData, lastUpdated: new Date() }, { merge: true });
    } catch (err) {
      console.error("Save Error:", err);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const callGemini = async (prompt, isFollowUp = false) => {
    setIsLoading(true);
    setError(null);

    const systemPrompt = `
      You are 'Socratic AI', a learning catalyst.
      1. NEVER provide the direct answer immediately.
      2. Analyze from Scientific, Ethical, and Future perspectives.
      3. Generate exactly 3 'Reverse Prompts' to guide the student.
      4. Provide a 'Masked Answer' summary.
      Response as JSON.
    `;

    const userPayload = isFollowUp 
      ? `Student answered: "${prompt}". Provide encouragement and 1 more deep follow-up question.`
      : `Student asked: "${prompt}"`;

    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
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
                  perspectives: {
                    type: "OBJECT",
                    properties: {
                      scientific: { type: "STRING" },
                      ethical: { type: "STRING" },
                      future: { type: "STRING" }
                    }
                  }
                }
              }
            }
          })
        });

        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        return JSON.parse(data.candidates[0].content.parts[0].text);
      } catch (err) {
        retries++;
        await new Promise(res => setTimeout(res, Math.pow(2, retries) * 1000));
        if (retries === maxRetries) return null;
      }
    }
  };

  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    if (!userQuery.trim()) return;

    const query = userQuery;
    setUserQuery("");
    const newMessages = [...messages, { type: 'user', text: query }];
    setMessages(newMessages);
    
    const result = await callGemini(query);
    if (result) {
      const updatedMessages = [...newMessages, { 
        type: 'ai', 
        text: "좋은 질문이야! 하지만 바로 답을 알기 전에, 이 질문들에 대해 먼저 생각해보면 어떨까?",
        prompts: result.reversePrompts
      }];
      setMessages(updatedMessages);
      setMaskedAnswer(result.maskedAnswer);
      setThoughtMap(result.perspectives);
      setFrictionScore(20);
      
      syncToCloud({
        messages: updatedMessages,
        maskedAnswer: result.maskedAnswer,
        thoughtMap: result.perspectives,
        frictionScore: 20,
        lastQuery: query
      });
    }
    setIsLoading(false);
  };

  const handlePromptClick = async (prompt) => {
    const newMessages = [...messages, { type: 'user', text: `탐구 답변: ${prompt}` }];
    setMessages(newMessages);
    const newFriction = Math.min(frictionScore + 25, 100);
    setFrictionScore(newFriction);
    
    const result = await callGemini(prompt, true);
    if (result) {
      const updatedMessages = [...newMessages, { 
        type: 'ai', 
        text: "훌륭한 접근이야! 네 생각이 점점 깊어지고 있어.",
        prompts: result.reversePrompts.slice(0, 1)
      }];
      setMessages(updatedMessages);
      syncToCloud({ messages: updatedMessages, frictionScore: newFriction });
    }
    setIsLoading(false);
  };

  const resetCurrentSession = async () => {
    if (window.confirm('현재 탐구 내용을 초기화할까요?')) {
      const resetData = { messages: [], frictionScore: 0, thoughtMap: null, maskedAnswer: null, lastQuery: "" };
      setMessages([]);
      setFrictionScore(0);
      setThoughtMap(null);
      setMaskedAnswer(null);
      await syncToCloud(resetData);
    }
  };

  const StudentView = () => (
    <div className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-500">
      {/* Left Side: Chat Interface */}
      <section className="lg:col-span-7 flex flex-col h-[calc(100vh-180px)] bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
           <span className="text-sm font-bold flex items-center gap-2">
             <MessageSquare size={16} className="text-blue-600" />
             탐구 대화 (Inquiry Thread)
           </span>
           <button onClick={resetCurrentSession} className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors">
             <RefreshCcw size={12} /> 데이터 초기화
           </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-60">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
                <Lightbulb size={40} className="text-slate-300" />
              </div>
              <div>
                <p className="text-lg font-bold">{userName.split(' ')[0]}님, 궁금한 것이 있나요?</p>
                <p className="text-sm text-slate-500">질문을 던지면 클라우드에 자동으로 저장됩니다.</p>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                msg.type === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
              }`}>
                <p className="text-sm md:text-base leading-relaxed">{msg.text}</p>
                {msg.prompts && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-tighter">역질문 (Reverse Prompts):</p>
                    {msg.prompts.map((p, i) => (
                      <button 
                        key={i}
                        onClick={() => handlePromptClick(p)}
                        className="w-full text-left p-3 text-sm rounded-xl border border-blue-100 bg-blue-50 hover:bg-blue-100 text-blue-800 transition-all flex items-center justify-between group"
                      >
                        {p}
                        <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && <div className="flex justify-start animate-pulse"><div className="bg-slate-100 rounded-2xl p-4 flex gap-2"><div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce delay-75"></div><div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce delay-150"></div></div></div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-slate-200">
          <form onSubmit={handleInitialSubmit} className="relative">
            <input type="text" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="지구가 평평했다면 어땠을까? (궁금한 것을 물어보세요)" className="w-full p-4 pr-14 bg-slate-100 rounded-2xl border-none focus:ring-2 focus:ring-blue-500 transition-all text-sm" disabled={isLoading}/>
            <button type="submit" className="absolute right-2 top-2 p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50" disabled={isLoading || !userQuery.trim()}><Search size={20} /></button>
          </form>
        </div>
      </section>

      {/* Right Side: Insights */}
      <aside className="lg:col-span-5 space-y-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-6 relative overflow-hidden">
          <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4"><Lock size={18} className="text-orange-500" /> 지식의 핵심 (Masked Answer)</h3>
          <div className={`p-4 rounded-xl relative transition-all duration-500 ${frictionScore < 80 ? 'bg-slate-100 select-none' : 'bg-green-50'}`}>
            <p className={`text-sm leading-relaxed transition-all duration-700 ${frictionScore < 80 ? 'blur-md opacity-40' : 'blur-none opacity-100'}`}>{maskedAnswer || "질문을 먼저 던져주세요."}</p>
            {frictionScore < 80 && <div className="absolute inset-0 flex flex-col items-center justify-center"><Lock size={24} className="text-slate-400 mb-2" /><p className="text-xs font-bold text-slate-500">충분한 질문이 필요합니다 ({frictionScore}/80)</p></div>}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-6 flex flex-col min-h-[350px]">
          <h3 className="font-bold text-slate-700 mb-6 flex items-center gap-2"><Network size={18} className="text-blue-600" /> 사고 지도 (Thought Map)</h3>
          {!thoughtMap ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-40 text-center"><Network size={40} className="text-slate-300 mb-4" /><p className="text-sm font-medium">질문을 분석하면<br/>사고의 경로가 시각화됩니다.</p></div>
          ) : (
            <div className="flex-1 space-y-4">
              {['scientific', 'ethical', 'future'].map((key, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 border-white shadow-sm ${i===0?'bg-blue-100':i===1?'bg-orange-100':'bg-purple-100'}`}>
                    {i===0?<Zap size={18} className="text-blue-600"/>:i===1?<TrendingUp size={18} className="text-orange-600"/>:<Lightbulb size={18} className="text-purple-600"/>}
                  </div>
                  <div className="flex-1 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold uppercase mb-1 opacity-60">{key}</p>
                    <p className="text-sm font-bold text-slate-700">{thoughtMap[key]}</p>
                  </div>
                </div>
              ))}
              <button className="w-full mt-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-2"><Share2 size={14} /> Share to Class</button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );

  const AdminView = () => (
    <div className="max-w-7xl mx-auto p-4 md:p-6 animate-in slide-in-from-right-4 duration-500">
       <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
             <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <TableIcon className="text-blue-600" /> 실시간 탐구 데이터베이스
                </h2>
                <p className="text-sm text-slate-500 mt-1">모든 학생의 지적 성장 데이터를 한눈에 확인하세요.</p>
             </div>
             <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2">
                  <User size={12} /> 활성 학생: {allProfiles.length}명
                </span>
             </div>
          </div>

          <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
                <thead>
                   <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-bold">
                      <th className="px-6 py-4 border-b border-slate-100">학생 이름</th>
                      <th className="px-6 py-4 border-b border-slate-100">마지막 질문</th>
                      <th className="px-6 py-4 border-b border-slate-100">인지적 마찰 (게이지)</th>
                      <th className="px-6 py-4 border-b border-slate-100">메시지 수</th>
                      <th className="px-6 py-4 border-b border-slate-100">마지막 업데이트</th>
                   </tr>
                </thead>
                <tbody className="text-sm">
                   {allProfiles.length === 0 ? (
                     <tr><td colSpan="5" className="px-6 py-20 text-center text-slate-400">아직 등록된 학생 데이터가 없습니다.</td></tr>
                   ) : (
                     allProfiles.map((profile, idx) => (
                       <tr key={idx} className="hover:bg-blue-50/50 transition-colors border-b border-slate-50 group">
                          <td className="px-6 py-4 font-bold text-slate-800">{profile.id}</td>
                          <td className="px-6 py-4 text-slate-600 truncate max-w-xs">{profile.lastQuery || '-'}</td>
                          <td className="px-6 py-4">
                             <div className="flex items-center gap-3">
                                <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
                                   <div className={`h-full ${profile.frictionScore >= 80 ? 'bg-blue-500' : 'bg-orange-400'}`} style={{width: `${profile.frictionScore}%`}} />
                                </div>
                                <span className="font-bold text-slate-700">{profile.frictionScore || 0}%</span>
                             </div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 font-medium">{(profile.messages || []).length}개</td>
                          <td className="px-6 py-4 text-slate-400 text-xs">
                             {profile.lastUpdated?.toDate ? profile.lastUpdated.toDate().toLocaleString() : '방금 전'}
                          </td>
                       </tr>
                     ))
                   )}
                </tbody>
             </table>
          </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-xl text-white"><Brain size={24} /></div>
          <div><h1 className="font-bold text-lg leading-tight">Socratic AI</h1><p className="text-xs text-slate-500 font-medium tracking-wide uppercase">The Inquiry Architect</p></div>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl">
           <button 
             onClick={() => setView('student')}
             className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${view === 'student' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
           >
             <GraduationCap size={16} /> 학생 모드
           </button>
           <button 
             onClick={() => setView('admin')}
             className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${view === 'admin' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
           >
             <LayoutDashboard size={16} /> 선생님 모드
           </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input autoFocus className="text-sm font-bold border-b-2 border-blue-600 outline-none w-32" value={tempName} onChange={(e) => setTempName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && toggleEditName()}/>
                <button onClick={toggleEditName} className="text-green-600"><Check size={16}/></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingName(true)}>
                <span className="text-sm font-bold">{userName}</span>
                <Edit2 size={12} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <span className="text-[10px] text-blue-600 font-bold uppercase">Learning Profile</span>
          </div>
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm overflow-hidden"><User className="text-blue-600" /></div>
        </div>
      </header>

      {view === 'student' ? <StudentView /> : <AdminView />}
    </div>
  );
};

export default App;