// objc_catch.m — Objective-C trampoline so Rust can catch NSExceptions.
//
// Rust cannot catch foreign (non-Rust) exceptions. When any ObjC code
// raises an NSException and it unwinds through a Rust frame, the Rust
// runtime aborts with "fatal runtime error: Rust cannot catch foreign
// exceptions, aborting". That has been the source of every "read-only
// tool → immediate abort" crash we've seen from the desktop module on
// macOS 26.3.
//
// This file compiles to a C-ABI symbol Rust links to via FFI. The
// trampoline wraps a Rust callback (passed as `work(ctx)`) in
// @try/@catch, copies the exception's name+reason into a heap-allocated
// C string the caller must free, and returns NULL on success.
//
// We intentionally do NOT dispatch_async to main here — scheduling is
// the caller's decision. The only job of this file is "catch the ObjC
// exception so Rust stays alive".

#import <Foundation/Foundation.h>
#include <string.h>
#include <stdlib.h>

typedef void (*orgii_work_fn)(void *ctx);

/// Run `work(ctx)` inside @try/@catch.
///
/// On success: returns NULL.
/// On NSException: returns a malloc'd NUL-terminated UTF-8 string shaped
/// like `"NSName: reason"`. The caller MUST free() it with `orgii_objc_free`.
const char *orgii_objc_catch(orgii_work_fn work, void *ctx) {
    @try {
        work(ctx);
        return NULL;
    } @catch (NSException *e) {
        NSString *msg = [NSString stringWithFormat:@"%@: %@",
                         e.name ?: @"NSException",
                         e.reason ?: @"(no reason)"];
        const char *utf8 = [msg UTF8String];
        if (!utf8) {
            return strdup("NSException: (description unavailable)");
        }
        return strdup(utf8);
    } @catch (id other) {
        return strdup("NSException: (non-NSException object)");
    }
}

void orgii_objc_free(const char *s) {
    if (s) free((void *)s);
}
