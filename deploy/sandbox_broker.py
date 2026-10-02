"""Root-owned narrow Docker broker. No mounts, host environment, or caller Docker flags."""
import json,os,re,select,socketserver,subprocess,threading,time
SOCKET='/run/paper-sandbox/broker.sock'
IMAGE='paper-agent-sandbox:1'
# Includes the Agent's separate queue allowance and supervisor shutdown grace.
SANDBOX_TTL=1200
lock=threading.Lock();jobs={}

def stop(key):
 row=jobs.pop(key,None)
 if row:
  subprocess.run(['docker','rm','-f','paper-sandbox-'+key],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
  row[0].wait(timeout=15)

def invoke(key,name,args):
 if not re.fullmatch('[0-9a-f]{32}',key):raise ValueError('Invalid run')
 with lock:
  if name=='close':stop(key);return {'result':{}}
  if name not in {'read','bash','edit','write','grep','find','ls','put_file','get_file'}:raise ValueError('Invalid tool')
  if key not in jobs:
   if len(jobs)>=3:raise ValueError('Sandbox concurrency limit reached')
   command=['docker','run','--rm','-i','--name','paper-sandbox-'+key,'--label','paper.agent-sandbox=true','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--memory-swap','256m','--cpus','0.5','--pids-limit','64','--ulimit','nofile=256:256','--ulimit','fsize=33554432:33554432','--tmpfs','/work:rw,nosuid,nodev,size=134217728,mode=1777','--tmpfs','/tmp:rw,nosuid,nodev,size=33554432,mode=1777',IMAGE]
   proc=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
   jobs[key]=(proc,threading.Lock(),time.monotonic())
  proc,guard,created=jobs[key]
 with guard:
  proc.stdin.write((json.dumps({'name':name,'args':args})+'\n').encode());proc.stdin.flush()
  data=bytearray();deadline=time.monotonic()+70
  while time.monotonic()<deadline:
   if select.select([proc.stdout],[],[],1)[0]:
    chunk=os.read(proc.stdout.fileno(),65536)
    if not chunk:raise ValueError('Sandbox stopped')
    data.extend(chunk)
    if len(data)>30*1024*1024:raise ValueError('Output too large')
    if data.endswith(b'\n'):return json.loads(data)
  raise ValueError('Sandbox command timed out')

class Handler(socketserver.StreamRequestHandler):
 def handle(self):
  self.connection.settimeout(85)
  try:
   raw=self.rfile.readline(30*1024*1024+1)
   if len(raw)>30*1024*1024:raise ValueError('Input too large')
   body=json.loads(raw);reply=invoke(body['run'],body['name'],body.get('args',{}))
  except Exception as e:
   reply={'error':str(e)[:500]}
   if 'body' in locals() and re.fullmatch('[0-9a-f]{32}',str(body.get('run',''))):
    with lock:stop(body['run'])
  self.wfile.write((json.dumps(reply)+'\n').encode())

def reap():
 while True:
  time.sleep(10)
  with lock:
   for key,row in list(jobs.items()):
    if time.monotonic()-row[2]>SANDBOX_TTL or row[0].poll() is not None:stop(key)

if __name__=='__main__':
 # Recover only our containers after broker restart.
 ids=subprocess.check_output(['docker','ps','-aq','--filter','label=paper.agent-sandbox=true'],text=True).split()
 if ids:subprocess.run(['docker','rm','-f',*ids],stdout=subprocess.DEVNULL)
 os.makedirs(os.path.dirname(SOCKET),exist_ok=True)
 if os.path.exists(SOCKET):os.unlink(SOCKET)
 class Server(socketserver.ThreadingUnixStreamServer):daemon_threads=True
 with Server(SOCKET,Handler) as server:
  import grp
  os.chown(SOCKET,0,grp.getgrnam('paper-platform').gr_gid);os.chmod(SOCKET,0o660)
  threading.Thread(target=reap,daemon=True).start();server.serve_forever()
