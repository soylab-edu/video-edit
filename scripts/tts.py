"""Microsoft Edge online TTS, honoring the environment's HTTPS proxy."""
import argparse
import asyncio
import os
# Use the OS certificate store (including the managed proxy CA) in addition to
# public roots. TLS peer and hostname verification remain enabled.
import truststore
truststore.inject_into_ssl()
import edge_tts

parser = argparse.ArgumentParser()
parser.add_argument('--text', required=True)
parser.add_argument('--voice', required=True)
parser.add_argument('--rate', default='+0%')
parser.add_argument('--output', required=True)
args = parser.parse_args()

async def main():
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    await edge_tts.Communicate(args.text, args.voice, rate=args.rate, proxy=proxy).save(args.output)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # Avoid leaking proxy details or service credentials in application logs.
        raise SystemExit(f'Microsoft TTS connection failed: {type(error).__name__}')
