import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// 1. Initialize Stripe securely
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 2. Initialize Supabase with the SERVICE ROLE KEY to bypass RLS
const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 3. Vercel config: Turn off default body parsing so Stripe can read the raw data
export const config = {
    api: {
        bodyParser: false,
    },
};

// Helper function to read the raw request body
const getRawBody = (req) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const payload = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    let event;

    try {
        // 4. Cryptographically verify the request actually came from Stripe
        event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 5. Handle the successful checkout event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // This is the user.id we passed in the frontend URL!
        const userId = session.client_reference_id; 

        if (userId) {
            // Update the user's profile to premium
            const { error } = await supabase
                .from('profiles')
                .update({ is_premium: true })
                .eq('id', userId);

            if (error) {
                console.error('Error updating user in Supabase:', error);
                return res.status(500).json({ error: 'Database update failed' });
            }

            console.log(`Successfully upgraded user: ${userId}`);

            // Thank-you email is a courtesy on top of what already succeeded
            // above -- a failure here is only ever logged, never turned into
            // a webhook failure (which would just make Stripe retry the
            // whole event, re-running an already-successful DB update for
            // nothing). Routed through api/resend.js's own 'pro-welcome'
            // action rather than duplicated here, since that's the one place
            // this app's Resend-sending code lives.
            const purchaserEmail = session.customer_details?.email || session.customer_email;
            if (purchaserEmail) {
                try {
                    await fetch('https://huddleff.app/api/resend', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'pro-welcome', email: purchaserEmail }),
                    });
                } catch (mailErr) {
                    console.error('Pro welcome email trigger failed:', mailErr);
                }
            } else {
                console.error('No purchaser email found on Stripe session -- skipping Pro welcome email.');
            }
        } else {
            console.error('No client_reference_id found in Stripe session.');
        }
    }

    res.json({ received: true });
}