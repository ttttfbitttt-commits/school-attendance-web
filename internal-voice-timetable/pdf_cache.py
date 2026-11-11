"""Bounded in-memory cache for identical school-scoped PDF renderings."""
import hashlib
import threading
import time
from collections import OrderedDict

class PdfCache:
    def __init__(self, max_bytes=24 * 1024 * 1024, max_entries=24, ttl=600):
        self.max_bytes=max_bytes
        self.max_entries=max_entries
        self.ttl=ttl
        self.entries=OrderedDict()
        self.size=0
        self.lock=threading.Lock()

    def get_or_render(self, tenant, html, render):
        key=(str(tenant),hashlib.sha256(html.encode('utf-8')).digest())
        now=time.monotonic()
        with self.lock:
            for old,(expires,pdf) in list(self.entries.items()):
                if expires<=now:
                    self.size-=len(pdf);del self.entries[old]
            found=self.entries.get(key)
            if found:
                self.entries.move_to_end(key)
                return found[1]
        pdf=render()
        if len(pdf)>self.max_bytes:
            return pdf
        with self.lock:
            old=self.entries.pop(key,None)
            if old:self.size-=len(old[1])
            while self.entries and (len(self.entries)>=self.max_entries or self.size+len(pdf)>self.max_bytes):
                _,(_,item)=self.entries.popitem(last=False);self.size-=len(item)
            self.entries[key]=(time.monotonic()+self.ttl,pdf);self.size+=len(pdf)
        return pdf
