import 'dotenv/config';

export function getAvalancheRpc() {
    return process.env.AVALANCHE_RPC;
}