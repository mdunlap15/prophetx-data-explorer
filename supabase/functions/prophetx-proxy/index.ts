import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_URL = 'https://api-ss-sandbox.betprophet.co';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { method = 'GET', endpoint, body, accessToken } = await req.json();
    
    console.log('Calling ProphetX:', method, endpoint);
    console.log('Request body:', body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'ProphetX-Client/1.0',
    };

    // Add authorization header if accessToken is provided
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${BASE_URL}/partner${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    console.log('Location:', response.headers.get('location'));
    
    const raw = await response.text();
    console.log('Raw body (first 300 chars):', raw.slice(0, 300));

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Non-JSON response received:', contentType);
      return new Response(JSON.stringify({ 
        error: `API returned ${contentType || 'unknown content type'} instead of JSON`,
        status: response.status,
        body: raw.slice(0, 500)
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!response.ok) {
      // Forward exact ProphetX error response
      const text = await response.text();
      return new Response(text, { 
        status: response.status, 
        headers: { 
          'content-type': response.headers.get('content-type') || 'application/json',
          ...corsHeaders
        } 
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(JSON.stringify({ 
        error: 'Failed to parse JSON response',
        parseError: parseError.message,
        body: raw.slice(0, 500)
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify(data), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': response.headers.get('X-RateLimit-Remaining') || '100'
      },
    });
  } catch (error) {
    console.error('Error in prophetx-proxy function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});