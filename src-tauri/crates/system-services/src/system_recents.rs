#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject};

#[cfg(target_os = "macos")]
pub fn clear_system_recent_documents() {
    dispatch2::DispatchQueue::main().exec_async(|| unsafe {
        let document_controller_class =
            AnyClass::get(c"NSDocumentController").expect("NSDocumentController");
        let document_controller: *mut AnyObject =
            msg_send![document_controller_class, sharedDocumentController];
        if document_controller.is_null() {
            return;
        }
        let _: () = msg_send![
            document_controller,
            clearRecentDocuments: std::ptr::null::<AnyObject>(),
        ];
    });
}

#[cfg(not(target_os = "macos"))]
pub fn clear_system_recent_documents() {}
