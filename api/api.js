// api.js - Single file backend for Vercel
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { action } = req.query;
  
  // --- GET USER IP ---
  if (action === 'getIp') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    return res.status(200).json({ ip: ip.replace(/^.*:/, '') });
  }
  
  // --- CHECK EXISTING SESSION ---
  if (action === 'checkSession') {
    const { ip } = req.body;
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_ip', ip)
      .eq('is_complete', false)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ session: data?.[0] || null });
  }
  
  // --- CREATE NEW SESSION ---
  if (action === 'createSession') {
    const { ip, username } = req.body;
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert([{
        user_ip: ip,
        username: username,
        exchange_count: 0,
        is_complete: false,
        likes_count: 0,
        personality_id: null
      }])
      .select()
      .single();
    
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ session: data });
  }
  
  // --- LOAD MESSAGES ---
  if (action === 'loadMessages') {
    const { sessionId } = req.body;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ messages: data || [] });
  }
  
  // --- ADD MESSAGE & UPDATE EXCHANGE COUNT ---
  if (action === 'addMessage') {
    const { sessionId, content, isUser } = req.body;
    
    const { error: msgError } = await supabase
      .from('chat_messages')
      .insert([{
        session_id: sessionId,
        content: content,
        is_user: isUser
      }]);
    
    if (msgError) return res.status(500).json({ error: msgError.message });
    
    if (isUser) {
      const { data: session } = await supabase
        .from('chat_sessions')
        .select('exchange_count')
        .eq('id', sessionId)
        .single();
      
      const newCount = (session?.exchange_count || 0) + 1;
      const isComplete = newCount >= 10;
      
      await supabase
        .from('chat_sessions')
        .update({ exchange_count: newCount, is_complete: isComplete })
        .eq('id', sessionId);
    }
    
    return res.status(200).json({ success: true });
  }
  
  // --- GET BOT REPLY (Cerebras) ---
  if (action === 'getReply') {
    const { messages } = req.body;
    
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cerebrasKey}`
      },
      body: JSON.stringify({
        model: 'gpt-oss-120b',
        messages: messages,
        temperature: 0.1,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    return res.status(200).json(data);
  }
  
  // --- LOAD EXPLORE CONVERSATIONS ---
  if (action === 'explore') {
    const { sort } = req.body;
    let query = supabase.from('chat_sessions').select('*');
    
    if (sort === 'complete') {
      query = query.eq('is_complete', true).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }
    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ conversations: data || [] });
  }
  
  return res.status(404).json({ error: 'Unknown action' });
}
